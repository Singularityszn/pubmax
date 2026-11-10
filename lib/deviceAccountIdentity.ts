// The signed-in account is the only identity authority on a device.
//
// WHY THIS EXISTS: a drinker signed out of one account and created a second one
// in the same browser. Nothing cleared the first account's device-cached
// artifacts, so `pubmax_handle` outlived the session that earned it and every
// surface that reads it - the You tab, the profile route, the follow actor -
// kept answering with the previous person's handle. The account was right and
// the app was wrong about who it belonged to, which is worse than a missing
// answer: the reader has no way to tell there is anything to disbelieve.
//
// THE RULE: a device artifact may claim to be the signed-in account only while
// the stamped owner IS that account. Any other user id - a second account, a
// device that predates this stamp, a browser whose stamp was evicted - is not
// proof of ownership, so the whole set is dropped in ONE pass and the server
// read re-establishes the truth. Dropping is cheap and self-healing:
// `resolveCanonicalIdentity` rewrites the handle on the next tick.
//
// WHAT IS NOT HERE: a device-only artifact that never claimed account backing.
// Night Profile clearing and provider sign-out retention follow
// docs/rules/lib-identity-accounts-and-sessions.md.

import {
  NIGHT_PROFILE_DEVICE_KEY,
  readDeviceNightProfileProvenance,
} from "@/lib/nightProfileDeviceProvenance";
import { showLegRouteOnMap } from "@/lib/legRouteOnMap";

/** Which account the device-cached identity artifacts below belong to. */
export const DEVICE_ACCOUNT_OWNER_KEY = "pubmax_account_owner";

/** Same-tab notice that the device identity set changed under a reader. */
export const DEVICE_IDENTITY_CHANGED_EVENT = "pubmax:device-identity-changed";

/**
 * Every localStorage artifact that speaks for the signed-in account. A key
 * belongs here when reading it could make the app name, route, or act as a
 * person - not merely when it is a preference the account happens to hold.
 */
export const DEVICE_IDENTITY_LOCAL_KEYS = [
  // The handle every composer, actor and profile route signs with.
  "pubmax_handle",
  // Pre-Wave-I comment-only handle; still migrated into the key above on read.
  "pubmax:comment:handle",
  // A self-asserted Round handle, which the diary attributes spend to.
  "pubmax_round_anonymous_identity_v1",
  // An armed account nudge belongs to the person who armed it.
  "pubmax:identityNudge:pending:v1",
  "pubmax:identityNudge:pendingAt:v1",
  "pubmax:identityNudge:dismissedAt:v1",
  // Badge event opt-ins are chosen on the owner's own profile.
  "pubmax-badge-event-opt-ins",
  // The host name the plan composer remembers prints on every share card.
  "pubmax:plan-host-name:v1",
  "pubmaxx:plan-route-draft:v1",
  "pubmax:plan-route-draft:v2",
  "pubmax:plan-intake:v1",
  // The Pub Pal this browser last saved (lib/localPal.ts): its name and
  // portrait stand in the dock, on the map and on the recap postcard.
  "pubmax_pub_pal_v1",
  // Tonight's answer to the Pal's evening question (lib/palNightQuestion.ts).
  "pubmax:pal-night-answer:v1",
  // The Pal's stamp book of answered price quests (lib/palQuest.ts).
  "pubmax:pal-quest-stamps:v1",
  // This account's unconfirmed Pint Drops (lib/optimisticSpillPost.ts): a
  // failed one carries a Retry that would post it under whoever is signed in.
  "pubmax:optimistic-spill-posts:v1",
] as const;

/** The sessionStorage half of the same set. */
export const DEVICE_IDENTITY_SESSION_KEYS = [
  "pubmaxx:plan-draft:v1",
  "pubmax:plan-draft:v2",
  // Private turn orders for this account's Rounds, kept only in this tab.
  "pubmax:wild-round-rota:v1",
  // Who a referral asked the arriving account to follow back.
  "pubmax:referral-follow-handle",
  // The one-shot arrival greeting names a person.
  "pubmax:arrival-welcome:v1",
] as const;

/**
 * Session drafts a live account leaves behind. They are cleared only when that
 * account departs (sign-out or a switch in this tab), never on a first sign-in:
 * a signed-out person who typed one and then signed in to post it keeps it.
 */
const DEPARTED_ACCOUNT_SESSION_KEYS = [
  "pubmaxx:price-mission-dismiss:v1",
  "pubmax:ask-plan-draft:v1",
] as const;

/** Prefixes of per-venue session drafts with the same departure rule. */
const DEPARTED_ACCOUNT_SESSION_PREFIXES = ["pubmax_pint_drop_draft:"] as const;

type WritableStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type SweepableStorage = WritableStorage & Partial<Pick<Storage, "key" | "length">>;

function readKey(storage: WritableStorage | null, key: string): string | null {
  if (!storage) return null;
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function removeKey(storage: WritableStorage | null, key: string): void {
  if (!storage) return;
  try {
    storage.removeItem(key);
  } catch {
    // Blocked storage cannot hold a stale identity either.
  }
}

function writeKey(
  storage: WritableStorage | null,
  key: string,
  value: string,
): void {
  if (!storage) return;
  try {
    storage.setItem(key, value);
  } catch {
    // Account ownership is durable even when browser storage is blocked.
  }
}

/**
 * Drop every device artifact that claims to be an account, in one pass. The
 * owner stamp is left to the caller: a sign-out removes it, an account change
 * replaces it, and doing that inside this function would hide which happened.
 */
export function clearDeviceAccountArtifacts(
  local: WritableStorage | null,
  session: WritableStorage | null = null,
): void {
  for (const key of DEVICE_IDENTITY_LOCAL_KEYS) removeKey(local, key);
  clearDeviceAccountSessionArtifacts(session);
  // A Night Profile mirrored off an account is that account's answer wearing a
  // device label. One typed on this device belongs to the device and stays.
  if (readDeviceNightProfileProvenance(local) === "account") {
    removeKey(local, NIGHT_PROFILE_DEVICE_KEY);
  }
}

/** Clear this tab's private artifacts without changing another tab's shared owner. */
export function clearDeviceAccountSessionArtifacts(session: WritableStorage | null): void {
  showLegRouteOnMap(null);
  for (const key of DEVICE_IDENTITY_SESSION_KEYS) removeKey(session, key);
}

/** Clear the drafts and dismissals a departing live account typed in this tab. */
export function clearDepartedAccountSessionDrafts(session: SweepableStorage | null): void {
  if (!session) return;
  for (const key of DEPARTED_ACCOUNT_SESSION_KEYS) removeKey(session, key);
  const prefixed: string[] = [];
  try {
    const length = session.length ?? 0;
    for (let index = 0; index < length; index += 1) {
      const key = session.key?.(index);
      if (key && DEPARTED_ACCOUNT_SESSION_PREFIXES.some((prefix) => key.startsWith(prefix))) {
        prefixed.push(key);
      }
    }
  } catch {
    // Blocked storage holds no draft to leak.
  }
  for (const key of prefixed) removeKey(session, key);
}

/**
 * Storage cleanup and mounted forms share this departure condition so private
 * inputs cannot outlive their account. This predicate performs no cleanup.
 * Clearing, retention and sign-in rules live in
 * docs/rules/lib-identity-accounts-and-sessions.md.
 */
export function liveAccountDeparted(
  previousUserId: string | null,
  nextUserId: string | null,
): boolean {
  return previousUserId !== null && previousUserId !== nextUserId;
}

/**
 * Bind this device's cached identity to `userId`, clearing everything the
 * previous owner left when the two differ. Returns true when a clear happened,
 * so the caller can tell readers to re-read.
 *
 * An ABSENT stamp counts as a different owner: a handle nobody vouched for may
 * not act as this account. That costs one canonical read on the first sign-in
 * after this ships and is right every time after.
 */
export function bindDeviceAccountOwner(
  userId: string,
  local: WritableStorage | null,
  session: WritableStorage | null = null,
): boolean {
  if (!userId) return false;
  if (readKey(local, DEVICE_ACCOUNT_OWNER_KEY) === userId) return false;
  clearDeviceAccountArtifacts(local, session);
  writeKey(local, DEVICE_ACCOUNT_OWNER_KEY, userId);
  return true;
}

/** Sign-out: the set goes, and so does the claim that anyone owns it. */
export function releaseDeviceAccountOwner(
  local: WritableStorage | null,
  session: SweepableStorage | null = null,
): void {
  clearDeviceAccountArtifacts(local, session);
  clearDepartedAccountSessionDrafts(session);
  removeKey(local, DEVICE_ACCOUNT_OWNER_KEY);
}

/** The account this device's cached identity was last stamped for. */
export function deviceAccountOwner(local: WritableStorage | null): string | null {
  const owner = readKey(local, DEVICE_ACCOUNT_OWNER_KEY);
  return owner ? owner : null;
}

/** Announce a device-identity change to same-tab readers. */
export function emitDeviceIdentityChanged(): void {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new Event(DEVICE_IDENTITY_CHANGED_EVENT));
  } catch {
    // Older engines without an Event constructor still keep the storage write.
  }
}

const DEVICE_IDENTITY_STORAGE_KEYS: ReadonlySet<string> = new Set([
  DEVICE_ACCOUNT_OWNER_KEY,
  ...DEVICE_IDENTITY_LOCAL_KEYS,
  ...DEVICE_IDENTITY_SESSION_KEYS,
]);

/**
 * True when a cross-tab `storage` event touched the identity set: one of its
 * keys, the owner stamp, or a whole-storage `clear()` (a null key). An event
 * that names no key at all is read as a clear, because it cannot prove it left
 * the set alone.
 *
 * Any other tab writes storage all the time - the auth client's lock and token
 * refresh, the device session list, a composer draft. Those are not an identity
 * change, and treating them as one made every reader re-ask who this is: /social
 * dropped its access answer and closed an open composer the moment a second tab
 * opened.
 */
function isDeviceIdentityStorageEvent(event: { key?: string | null }): boolean {
  return typeof event.key !== "string" || DEVICE_IDENTITY_STORAGE_KEYS.has(event.key);
}

/** Subscribe to same-tab writes plus cross-tab `storage` events on the identity set. */
export function subscribeDeviceIdentity(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = () => onChange();
  const storageHandler = (event: StorageEvent) => {
    if (isDeviceIdentityStorageEvent(event)) onChange();
  };
  window.addEventListener(DEVICE_IDENTITY_CHANGED_EVENT, handler);
  window.addEventListener("storage", storageHandler);
  return () => {
    window.removeEventListener(DEVICE_IDENTITY_CHANGED_EVENT, handler);
    window.removeEventListener("storage", storageHandler);
  };
}
