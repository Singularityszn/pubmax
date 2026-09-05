// Which Storage objects leave with an account, in ONE place.
//
// Supabase refuses `delete from storage.objects` at the statement level, and
// its own guide says a row deleted by SQL leaves its bytes orphaned in the
// bucket. So the bytes an account owns are removed through the Storage API by
// `deleteOwnAccount` (`lib/accountDeletion.server.ts`) BEFORE the auth row is
// deleted, and migration `0145`'s trigger then owns rows and columns alone.
// This module is the pure half: the prefixes an account's objects live under,
// the rule for a serving key's staging twin, and the batch size the Storage
// API accepts. It imports no server module, so the tests and the delete page
// can read the same answer.
//
// TWO KINDS OF OWNERSHIP. A PREFIX kind is found by walking the bucket: the
// profile's avatars and covers (`profileImageSlots`) and the account's Night
// Moment photos, which are keyed by the OWNER's id. A ROW kind is keyed by
// something else (a venue, a conversation), so its keys are read off the rows
// that carry them while those rows still exist: wall photos and message
// photos. Both kinds are listed here so a new per-account image lane has one
// table to join.

import { PROFILE_IMAGE_SLOT_SPECS } from "@/lib/profileImageSlots";

/** The Storage API removes at most this many objects in one call. */
export const STORAGE_REMOVE_BATCH = 1000;

/**
 * More objects than this under one account is not a person; it is a walk that
 * went wrong. The removal refuses rather than deleting past it.
 */
export const MAX_OWNED_OBJECTS = 5000;

/** The Night Moment photo prefix for one owner, or one owner's Memory. */
export function nightMomentObjectPrefix(ownerId: string, memoryId?: string): string {
  return memoryId ? `night-moments/${ownerId}/${memoryId}` : `night-moments/${ownerId}`;
}

/**
 * The bucket folders whose every object belongs to this account.
 *
 * A folder is named WITHOUT a trailing slash, the shape the Storage API's
 * `list` takes. An account that never claimed a handle has no profile and so
 * no avatar or cover folder; its Moment photos are still its own.
 */
export function ownedObjectFolders(input: {
  userId: string;
  profileId: string | null;
}): string[] {
  const folders: string[] = [];
  if (input.profileId) {
    for (const slot of Object.values(PROFILE_IMAGE_SLOT_SPECS)) {
      folders.push(`${slot.prefix}/${input.profileId}`);
    }
  }
  folders.push(nightMomentObjectPrefix(input.userId));
  return folders;
}

/**
 * The staging twin of a serving key, or null when the key has no `.jpg` tail.
 *
 * Every owned-image lane stages at `<serving>.staging.jpg` beside the serving
 * `<serving>.jpg` (`venuePhotoStagingKey`, `messagePhotoStagingKey`), and a
 * write that failed between the two leaves the staging object behind. The
 * tombstone trigger removed both with the same replace; this is that rule.
 */
export function stagingTwinOf(key: string): string | null {
  return key.endsWith(".jpg") && !key.endsWith(".staging.jpg")
    ? `${key.slice(0, -".jpg".length)}.staging.jpg`
    : null;
}

/**
 * The keys a set of rows names, each with its staging twin, deduplicated, in
 * a stable order. A null or blank key (a row with no photo) contributes
 * nothing.
 */
export function ownedObjectKeysFromRows(
  keys: ReadonlyArray<string | null | undefined>,
): string[] {
  const out = new Set<string>();
  for (const key of keys) {
    const trimmed = typeof key === "string" ? key.trim() : "";
    if (!trimmed) continue;
    out.add(trimmed);
    const twin = stagingTwinOf(trimmed);
    if (twin) out.add(twin);
  }
  return [...out];
}

/** The Storage API's batches: at most `STORAGE_REMOVE_BATCH` keys each. */
export function removalBatches(keys: readonly string[]): string[][] {
  const batches: string[][] = [];
  for (let start = 0; start < keys.length; start += STORAGE_REMOVE_BATCH) {
    batches.push(keys.slice(start, start + STORAGE_REMOVE_BATCH));
  }
  return batches;
}
