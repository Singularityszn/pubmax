"use client";

// One page load asked `/api/identity/handle/current` four to twelve times: the
// provider asked on mount and again on every auth event, and the password
// prompt, the account hub and the founders strip each asked for themselves.
// Production's limiter counts every one of them, so a normal browsing pace
// spent the budget and the pages that came next showed false states.
//
// This is the one read they share. It is single-flight per account and holds
// the answer for a moment so surfaces that mount a beat apart take the same
// answer rather than asking again.
//
// Identity is the one answer lib/surfaceDataCache.ts refuses to keep, because a
// held "who you are" is a stale handle waiting to name the wrong person. This
// module keeps that promise a different way, and the differences are the point:
//
//  - It is held for `CURRENT_IDENTITY_READ_MS` and no longer, in memory only,
//    never in storage.
//  - It is keyed by account id, so a second account never reads the first's.
//  - It is dropped the moment anything says the answer may have changed: a
//    claimed or renamed handle, a device identity change, a sign-in or sign-out,
//    or an account update such as a new password.
//  - A read that did not answer is never held, so a failure is asked again.

import { authedActionFetch } from "@/lib/authedFetch";
import { subscribeDeviceIdentity } from "@/lib/deviceAccountIdentity";

/** How long a settled answer is shared. Short: it only has to span one load. */
export const CURRENT_IDENTITY_READ_MS = 2_000;

export const CURRENT_IDENTITY_PATH = "/api/identity/handle/current";

export type CurrentIdentityBody = Readonly<Record<string, unknown>>;

export type CurrentIdentityRead =
  | Readonly<{ ok: true; status: number; body: CurrentIdentityBody | null }>
  | Readonly<{ ok: false; status: number; body: CurrentIdentityBody | null }>;

type Held = {
  userId: string;
  read: Promise<CurrentIdentityRead>;
  /** Set when the read settles with an answer worth sharing. */
  settledAt: number | null;
};

let held: Held | null = null;

/** Drop the shared answer. The next read asks the server. */
export function forgetCurrentIdentityRead(): void {
  held = null;
}

// The window the listeners are attached to, rather than a latched boolean, so
// they rebind where the global is replaced (a test, a navigation in a shell).
let boundWindow: unknown = null;
function bindBoundaries(): void {
  if (typeof window === "undefined" || boundWindow === window) return;
  boundWindow = window;
  subscribeDeviceIdentity(forgetCurrentIdentityRead);
  // The string is spelled out rather than imported: lib/identityClient.ts
  // imports this module, and the event name is part of its public contract.
  window.addEventListener("pubmaxx:identity-handle-changed", forgetCurrentIdentityRead);
}

async function parse(response: Response): Promise<CurrentIdentityRead> {
  const body = (await response.json().catch(() => null)) as CurrentIdentityBody | null;
  return response.ok
    ? { ok: true, status: response.status, body }
    : { ok: false, status: response.status, body };
}

/**
 * Read the signed-in account's identity once for everyone who asks.
 *
 * `load` makes the request, with whatever auth the caller already uses, and is
 * called only when nobody holds an answer for this account. It must not carry
 * the caller's own abort signal: the read is shared, so one surface leaving
 * must not cancel it for the others. A caller that has gone should check its
 * own signal after this resolves, as it did before.
 */
export function readCurrentIdentity(
  userId: string,
  load: () => Promise<Response>,
  now: number = Date.now(),
): Promise<CurrentIdentityRead> {
  bindBoundaries();
  const current = held;
  if (
    current &&
    current.userId === userId &&
    (current.settledAt === null || now - current.settledAt <= CURRENT_IDENTITY_READ_MS)
  ) {
    return current.read;
  }
  const entry: Held = {
    userId,
    settledAt: null,
    read: load().then(parse),
  };
  held = entry;
  entry.read = entry.read.then(
    (answer) => {
      if (held === entry) {
        if (answer.ok) entry.settledAt = Date.now();
        else held = null;
      }
      return answer;
    },
    (error: unknown) => {
      if (held === entry) held = null;
      throw error;
    },
  );
  return entry.read;
}

/** The shared read, made with the signed-in session's own action auth. */
export function readAuthedIdentity(userId: string): Promise<CurrentIdentityRead> {
  return readCurrentIdentity(userId, () =>
    authedActionFetch(CURRENT_IDENTITY_PATH, {}, { requiresIdentity: true }),
  );
}
