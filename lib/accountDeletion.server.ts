import "server-only";

// The ONE writer that deletes a PUBMAXX account.
//
// TWO PHASES, in an order that has to stay written down. First the account's
// own Storage objects are removed through the Storage API: the profile's
// avatars and covers, its Night Moment photos, the photos it put on pub walls
// and the photos it sent in messages (`lib/accountOwnedObjects.ts` is the
// table). Then `auth.admin.deleteUser(userId)` deletes the auth row, and
// migration `0078`'s BEFORE DELETE trigger, as restated by `0145`, does the
// rest: the profile tombstone, the wall photo rows, the cover rotation rows,
// the message attachment columns and the Social account's suspension.
//
// WHY THE BYTES GO FIRST. Supabase refuses `delete from storage.objects` at
// the statement level (SQLSTATE 42501, contribution battle test D01), and its
// own guide says a row deleted by SQL leaves the bytes orphaned, so the
// trigger may not remove objects. The wall photo rows and the message columns
// are what NAME the objects, and the trigger deletes or clears them, so the
// keys have to be collected while those rows still exist. A removal that
// fails leaves the account in place and answers `unavailable`, which the
// reader may retry; the objects already removed stay removed, and a retry
// finds fewer. The other order (auth row first, objects after) would leave
// orphans nobody could retry against, because the account that could ask
// would be gone.
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
  /** The serving keys of the photos this handle sent in messages. Throws on a read it could not run. */
  messagePhotoKeys(handle: string): Promise<string[]>;
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
    async messagePhotoKeys(handle) {
      const { data, error } = await admin()
        .from("messages")
        .select("attachment_object_key")
        .eq("sender_handle", handle)
        .not("attachment_object_key", "is", null);
      if (error) throw new Error(error.message);
      return (data ?? [])
        .map((row) => (row as { attachment_object_key?: unknown }).attachment_object_key)
        .filter((key): key is string => typeof key === "string");
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
        ...(await deps.messagePhotoKeys(profile.handle)),
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
 * Delete the account behind `userId`: its Storage objects first, then the auth
 * row, and the `0078` trigger does the rest.
 *
 * THREE-WAY on purpose, and the third answer is the point: a delete we could not
 * RUN is `unavailable` and is reported as a failure the reader may retry, while
 * an account that is already gone is a success. Merging them would either tell a
 * person their account survived an outage it did not, or tell them a live
 * account is deleted when nothing was written.
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

  for (const batch of removalBatches(keys)) {
    try {
      await deps.removeObjects(batch);
    } catch (err) {
      log("error", "account.delete_failed", { stage: "objects_not_removed", reason: failureReason(err) });
      return "unavailable";
    }
  }

  try {
    const { error } = await deps.deleteAuthUser(id);
    if (!error) return "deleted";
    if (isAlreadyGone(error)) return "already-gone";
    log("error", "account.delete_failed", { stage: "auth", reason: failureReason(error) });
    return "unavailable";
  } catch (err) {
    if (isAlreadyGone(err)) return "already-gone";
    log("error", "account.delete_failed", { stage: "auth", reason: failureReason(err) });
    return "unavailable";
  }
}
