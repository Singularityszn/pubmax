import "server-only";

// The ONE writer that deletes a PUBMAXX account.
//
// THREE PHASES, in an order that has to stay written down, and the middle one
// is where a failure is allowed to be a failure.
//
// (1) COLLECT the keys of every object the account owns: the profile's avatars
//     and covers, its Night Moment photos, the photos it put on pub walls and
//     the photos it sent in messages (`lib/accountOwnedObjects.ts` is the
//     table). This is a READ, and it has to happen first, because the wall
//     photo rows and the message columns are what NAME half of those objects
//     and the tombstone trigger deletes or clears them. A read we could not run
//     is `unavailable` and nothing has been touched. A message photo is asked
//     for by PROFILE as well as by handle, because `sender_handle` is text
//     stamped at send time and a rename does not rewrite it: migration `0151`
//     is what added the identity that cannot be renamed (review finding F-4).
// (2) DELETE the auth row. Migration `0078`'s BEFORE DELETE trigger, as
//     restated by `0145` and `0150`, does the rest: the retention ledger, the
//     retired-author stamps, the profile tombstone, the wall photo rows, the
//     cover rotation rows, the message attachment columns and the Social
//     account's suspension. A delete that fails here is `unavailable` and,
//     again, NOTHING HAS BEEN REMOVED.
// (3) REMOVE the objects through the Storage API, with the keys from (1).
//
// WHY THE BYTES GO LAST, which is a REVERSAL of the order `0145`'s header
// describes. Supabase refuses `delete from storage.objects` at the statement
// level (SQLSTATE 42501, contribution battle test D01), and its own guide says
// a row deleted by SQL leaves the bytes orphaned, so the trigger may not remove
// objects and the keys must be read before it runs. That argument is about
// COLLECTING the keys, and collecting is already its own phase — it was never
// an argument for removing the bytes first. Removing first meant that any
// failure after the removal loop answered `unavailable` over a LIVE account
// whose every photo had just been irreversibly deleted: a person who tapped
// Delete, read "Your account could not be deleted. Try again." and decided not
// to had silently lost every photo they ever uploaded, and their pub wall
// photos stayed on public walls as broken images (review finding F-5).
//
// THE COST OF THIS ORDER IS ORPHANED BYTES, and it is the smaller cost. When
// the auth row is gone and a removal batch then fails, the objects stay in the
// bucket with nothing pointing at them: the profile is tombstoned with its
// image keys nulled, the wall photo rows are deleted and the message attachment
// columns are cleared, so no product surface can serve one. It is logged by
// name (`account.delete_objects_orphaned`) for an operator sweep, the loop
// carries on to the batches it can still remove, and the outcome stays the auth
// row's: answering `unavailable` over an account that IS deleted would be the
// same lie in mirror image. A RETRY still helps, because the folder walk in (1)
// lists by prefix rather than by row: a second DELETE reads `already-gone`,
// finds the avatar, cover and Night Moment objects still there and removes
// them. Only the row-named keys are beyond a retry, which is the narrowest
// version of the old trade.
//
// The caller id is derived from the caller's own verified bearer at the route,
// never from a request field, so this function can only ever delete the account
// that asked. It takes the id rather than the request for exactly that reason:
// there is no argument here a caller could aim somewhere else.

import { type AccountDeletionOutcome } from "@/lib/accountDeletion";
import {
  MAX_OWNED_OBJECTS,
  ownedObjectFolders,
  ownedObjectKeysFromRows,
  removalBatches,
} from "@/lib/accountOwnedObjects";
import { log } from "@/lib/log";
import { profileStore } from "@/lib/profileStore";
import { requireSupabaseAdmin, STORAGE_BUCKET } from "@/lib/supabase";

/** One page of a Storage API folder listing. */
const LIST_PAGE = 1000;

/**
 * Codes and messages GoTrue answers with when the account is already gone.
 *
 * A second DELETE is not a failure. The browser that sent the first one may
 * never have seen its answer, and telling somebody their deleted account is
 * still here is worse than saying nothing.
 */
const ALREADY_GONE_CODES = new Set(["user_not_found", "not_found"]);

function isAlreadyGone(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { status?: unknown; code?: unknown; message?: unknown };
  if (candidate.status === 404) return true;
  if (typeof candidate.code === "string" && ALREADY_GONE_CODES.has(candidate.code)) {
    return true;
  }
  return (
    typeof candidate.message === "string"
    && /user not found/i.test(candidate.message)
  );
}

/**
 * PostgREST's undefined-column answer, for the one read that asks for a column
 * migration `0151` adds. A deploy that lands before the migration must still
 * delete accounts.
 */
function isMissingSenderProfileColumn(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; message?: unknown };
  if (candidate.code === "42703") return true;
  return (
    typeof candidate.message === "string"
    && /sender_profile_id/.test(candidate.message)
    && /does not exist|schema cache/i.test(candidate.message)
  );
}

function failureReason(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object") {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return "unknown";
}

/**
 * Everything the delete reaches for, as one seam.
 *
 * The default is the Supabase admin client; a test hands in a fake bucket and
 * a fake auth. Nothing here is a second cleanup pass over what the trigger
 * owns: these are the reads that find the OBJECTS, and the one write that
 * removes them.
 */
export type AccountDeletionDeps = {
  /** The account's profile, or null for an account that never claimed one. */
  profileForUser(userId: string): Promise<{ id: string; handle: string } | null>;
  /** Every object key under a bucket folder, walked recursively. Throws on a read it could not run. */
  listObjectKeys(folder: string): Promise<string[]>;
  /** The serving keys of the wall photos this profile authored. Throws on a read it could not run. */
  wallPhotoKeys(profileId: string): Promise<string[]>;
  /**
   * The serving keys of the photos this account sent in messages, by PROFILE
   * and by current handle. Throws on a read it could not run.
   *
   * Both, because `sender_handle` is text stamped at send time and a rename
   * does not rewrite it (review finding F-4), while `sender_profile_id` is
   * stamped from the alias table by migration `0151` and may be null on a row
   * older than its backfill.
   */
  messagePhotoKeys(profileId: string, handle: string): Promise<string[]>;
  /** Remove these objects through the Storage API. Throws when the API refused. */
  removeObjects(keys: readonly string[]): Promise<void>;
  /** GoTrue's admin delete of the auth row. */
  deleteAuthUser(userId: string): Promise<{ error: unknown }>;
};

function supabaseDeps(): AccountDeletionDeps {
  const admin = () => requireSupabaseAdmin();
  const bucket = () => admin().storage.from(STORAGE_BUCKET);
  return {
    async profileForUser(userId) {
      const profile = await profileStore().getByUserId(userId);
      return profile ? { id: profile.id, handle: profile.handle } : null;
    },
    async listObjectKeys(folder) {
      // The Storage API lists ONE level per call and marks a folder by a null
      // id, so a walk is what finds `night-moments/<owner>/<memory>/<file>`.
      const keys: string[] = [];
      const pending = [folder];
      while (pending.length > 0) {
        const dir = pending.pop() as string;
        for (let offset = 0; ; offset += LIST_PAGE) {
          const { data, error } = await bucket().list(dir, { limit: LIST_PAGE, offset });
          if (error) throw new Error(error.message);
          const page = data ?? [];
          for (const entry of page) {
            const path = `${dir}/${entry.name}`;
            if (entry.id === null || entry.id === undefined) pending.push(path);
            else keys.push(path);
          }
          if (keys.length > MAX_OWNED_OBJECTS) {
            throw new Error(`more than ${MAX_OWNED_OBJECTS} objects under ${folder}`);
          }
          if (page.length < LIST_PAGE) break;
        }
      }
      return keys;
    },
    async wallPhotoKeys(profileId) {
      const { data, error } = await admin()
        .from("venue_photos")
        .select("object_key")
        .eq("author_profile_id", profileId);
      if (error) throw new Error(error.message);
      return (data ?? [])
        .map((row) => (row as { object_key?: unknown }).object_key)
        .filter((key): key is string => typeof key === "string");
    },
    async messagePhotoKeys(profileId, handle) {
      const keys = (rows: unknown[] | null): string[] =>
        (rows ?? [])
          .map((row) => (row as { attachment_object_key?: unknown }).attachment_object_key)
          .filter((key): key is string => typeof key === "string");
      const attached = () =>
        admin().from("messages").select("attachment_object_key").not("attachment_object_key", "is", null);

      // The account's whole message history, by either identity. `.or` is one
      // round trip and one union; PostgREST refuses a bare `.eq` pair.
      const { data, error } = await attached().or(
        `sender_profile_id.eq.${profileId},sender_handle.eq.${handle}`,
      );
      if (!error) return keys(data);
      // Migration 0151 has not landed yet, so the column is not there. Fall back
      // to the handle alone, which is exactly the pre-0151 behaviour: it finds
      // less for a renamed account rather than refusing every deletion.
      if (isMissingSenderProfileColumn(error)) {
        const fallback = await attached().eq("sender_handle", handle);
        if (fallback.error) throw new Error(fallback.error.message);
        return keys(fallback.data);
      }
      throw new Error(error.message);
    },
    async removeObjects(keys) {
      const { error } = await bucket().remove([...keys]);
      if (error) throw new Error(error.message);
    },
    async deleteAuthUser(userId) {
      const { error } = await admin().auth.admin.deleteUser(userId);
      return { error };
    },
  };
}

/**
 * Every object key this account owns, read while the rows that name them are
 * still there. Throws when any read could not be run: a delete that removed
 * what it could see and left what it could not is not a deletion.
 */
export async function ownedObjectKeys(
  userId: string,
  deps: AccountDeletionDeps,
): Promise<string[]> {
  const profile = await deps.profileForUser(userId);
  const walked: string[] = [];
  for (const folder of ownedObjectFolders({ userId, profileId: profile?.id ?? null })) {
    walked.push(...(await deps.listObjectKeys(folder)));
  }
  const fromRows = profile
    ? [
        ...(await deps.wallPhotoKeys(profile.id)),
        ...(await deps.messagePhotoKeys(profile.id, profile.handle)),
      ]
    : [];
  // A walked folder already lists every object in it, staging twins included;
  // only a ROW-named key needs its twin derived.
  const keys = [...new Set([...walked, ...ownedObjectKeysFromRows(fromRows)])];
  if (keys.length > MAX_OWNED_OBJECTS) {
    throw new Error(`more than ${MAX_OWNED_OBJECTS} objects owned by one account`);
  }
  return keys;
}

/**
 * Delete the account behind `userId`: collect its object keys, delete the auth
 * row (the `0078` trigger does the rest), then remove the objects.
 *
 * THREE-WAY on purpose, and the third answer is the point: a delete we could not
 * RUN is `unavailable` and is reported as a failure the reader may retry, while
 * an account that is already gone is a success. Merging them would either tell a
 * person their account survived an outage it did not, or tell them a live
 * account is deleted when nothing was written.
 *
 * A FAILURE BEFORE THE AUTH ROW GOES REMOVES NOTHING. That is the whole point
 * of the order; see the header.
 */
export async function deleteOwnAccount(
  userId: string,
  deps: AccountDeletionDeps = supabaseDeps(),
): Promise<AccountDeletionOutcome> {
  const id = userId.trim();
  if (!id) return "unavailable";

  let keys: string[];
  try {
    keys = await ownedObjectKeys(id, deps);
  } catch (err) {
    log("error", "account.delete_failed", { stage: "objects_unreadable", reason: failureReason(err) });
    return "unavailable";
  }

  // The auth row goes BEFORE a single object is removed, so a delete that
  // cannot run leaves the account whole rather than photoless.
  let outcome: AccountDeletionOutcome;
  try {
    const { error } = await deps.deleteAuthUser(id);
    if (!error) outcome = "deleted";
    else if (isAlreadyGone(error)) outcome = "already-gone";
    else {
      log("error", "account.delete_failed", { stage: "auth", reason: failureReason(error) });
      return "unavailable";
    }
  } catch (err) {
    if (isAlreadyGone(err)) outcome = "already-gone";
    else {
      log("error", "account.delete_failed", { stage: "auth", reason: failureReason(err) });
      return "unavailable";
    }
  }

  // The account is gone. Every batch we can still remove is removed, and one
  // we cannot is named for an operator rather than turned into a refusal over
  // an account that no longer exists.
  for (const batch of removalBatches(keys)) {
    try {
      await deps.removeObjects(batch);
    } catch (err) {
      log("error", "account.delete_objects_orphaned", {
        stage: "objects_not_removed",
        objects: batch.length,
        reason: failureReason(err),
      });
    }
  }

  return outcome;
}
