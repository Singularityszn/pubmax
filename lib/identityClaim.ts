// Wave L3 — "Claim your night": preview + claim helpers for first-sign-in
// migration of a device-local handle onto a signed-in account.
//
// Pure decision helpers stay store-agnostic so tests can drive memory backends.
// Activity counts use the same handle-keyed stores as the profile surfaces
// (pint drops / saved pubs / follows) — linking profiles.user_id IS the
// migration (no row copy).

import { followStore } from "@/lib/followStore";
import { normalizeHandle } from "@/lib/profiles";
import { pintDropsStore } from "@/lib/pintDropsStore";
import { profileStore } from "@/lib/profileStore";
import { savedPubsStore } from "@/lib/savedPubsStore";

export type ClaimChoice = "device" | "auth";

export type ClaimActivity = {
  drops: number;
  saves: number;
  /** followers + following for the device handle. */
  follows: number;
};

export type ClaimPreview = {
  deviceHandle: string;
  authHandle: string;
  sameHandle: boolean;
  deviceActivity: ClaimActivity;
  /** Device handle's profiles.user_id is set to someone other than the caller. */
  deviceAlreadyLinkedToOther: boolean;
  /** Auth (email-derived) handle is linked to someone other than the caller. */
  authHandleAlreadyLinkedToOther: boolean;
};

export type ClaimResult =
  | { ok: true; handle: string; linked: true }
  | { ok: false; status: number; error: string };

/** Derive the account handle from a verified auth email local-part. */
export function authHandleFromEmail(email: string | null | undefined): string {
  if (!email || typeof email !== "string") return "";
  const local = email.split("@")[0] ?? "";
  return normalizeHandle(local);
}

function activityTotal(activity: ClaimActivity): number {
  return activity.drops + activity.saves + activity.follows;
}

/**
 * Whether the claim dialog should open.
 * Show when handles differ, the device handle has any activity, or either side
 * is already linked to another account (conflict — never silent overwrite).
 */
export function decideClaimNeed(preview: ClaimPreview): boolean {
  if (preview.deviceAlreadyLinkedToOther || preview.authHandleAlreadyLinkedToOther) {
    return true;
  }
  if (!preview.sameHandle) return true;
  return activityTotal(preview.deviceActivity) > 0;
}

function linkedToOther(
  userId: string | null | undefined,
  callerUserId: string,
): boolean {
  const linked = typeof userId === "string" && userId ? userId : null;
  return Boolean(linked && linked !== callerUserId);
}

/** Count handle-keyed social activity for claim preview. */
export async function countHandleActivity(handle: string): Promise<ClaimActivity> {
  const key = normalizeHandle(handle);
  if (!key) return { drops: 0, saves: 0, follows: 0 };

  const [drops, saves, counts] = await Promise.all([
    // Pass the author as viewer so friends-only drops they authored still count.
    pintDropsStore().listVisible(undefined, { handle: key }, key),
    savedPubsStore().listSaved({ handle: key }),
    followStore().counts(key),
  ]);

  return {
    drops: drops.length,
    saves: saves.length,
    follows: counts.followers + counts.following,
  };
}

/**
 * Build a claim preview for the signed-in caller. Requires a verified
 * `callerUserId` (from JWT) — never trust a client-supplied uid.
 */
export async function buildClaimPreview(input: {
  deviceHandle: string;
  authHandle: string;
  callerUserId: string;
}): Promise<ClaimPreview> {
  const deviceHandle = normalizeHandle(input.deviceHandle);
  const authHandle = normalizeHandle(input.authHandle);
  const caller = typeof input.callerUserId === "string" ? input.callerUserId.trim() : "";
  if (!caller) {
    throw new Error("buildClaimPreview requires a verified callerUserId.");
  }

  const store = profileStore();
  const [deviceProfile, authProfile, deviceActivity] = await Promise.all([
    deviceHandle ? store.getByHandle(deviceHandle) : Promise.resolve(null),
    authHandle ? store.getByHandle(authHandle) : Promise.resolve(null),
    deviceHandle
      ? countHandleActivity(deviceHandle)
      : Promise.resolve({ drops: 0, saves: 0, follows: 0 } satisfies ClaimActivity),
  ]);

  return {
    deviceHandle,
    authHandle,
    sameHandle: Boolean(deviceHandle && authHandle && deviceHandle === authHandle),
    deviceActivity,
    deviceAlreadyLinkedToOther: linkedToOther(deviceProfile?.userId, caller),
    authHandleAlreadyLinkedToOther: linkedToOther(authProfile?.userId, caller),
  };
}

/**
 * Link the chosen handle to the verified caller. Idempotent when already linked
 * to this user; 409 when the chosen handle belongs to someone else.
 *
 * `authHandle` MUST be server-derived from the JWT email (never trust the
 * client). Claiming a device handle that differs from the auth handle requires
 * real device activity — blocks fishing empty unlinked handles.
 */
export async function performClaim(input: {
  choice: ClaimChoice;
  deviceHandle: string;
  /** Server-derived from JWT email local-part. */
  authHandle: string;
  callerUserId: string;
}): Promise<ClaimResult> {
  const caller = typeof input.callerUserId === "string" ? input.callerUserId.trim() : "";
  if (!caller) {
    return { ok: false, status: 401, error: "Sign in to claim a handle." };
  }

  const deviceHandle = normalizeHandle(input.deviceHandle);
  const authHandle = normalizeHandle(input.authHandle);
  const choice = input.choice;

  if (choice !== "device" && choice !== "auth") {
    return { ok: false, status: 400, error: "Pick device or auth handle." };
  }

  if (!authHandle) {
    return { ok: false, status: 400, error: "Add an account handle." };
  }

  const handle = choice === "device" ? deviceHandle : authHandle;
  if (!handle) {
    return {
      ok: false,
      status: 400,
      error: choice === "device" ? "Add a device handle to keep." : "Add an account handle.",
    };
  }

  // Device path that differs from the account handle: only allow bringing a
  // handle that already has drops/saves/follows — never mint ownership of a
  // random empty unlinked handle in one shot.
  if (choice === "device" && handle !== authHandle) {
    const activity = await countHandleActivity(handle);
    if (activityTotal(activity) === 0) {
      return {
        ok: false,
        status: 400,
        error:
          "That device handle has no pubs, saves, or follows to claim. Use your account handle instead.",
      };
    }
  }

  const store = profileStore();
  try {
    const existing = await store.getByHandle(handle);
    if (linkedToOther(existing?.userId, caller)) {
      return {
        ok: false,
        status: 409,
        error:
          choice === "device"
            ? "That device handle already belongs to another account. Use your account handle, or sign in as its owner."
            : "That account handle already belongs to another user. Keep your device handle, or pick a different account.",
      };
    }

    // Unlinked, or already ours — linkUser is idempotent for the same uid.
    await store.linkUser(handle, caller);
    return { ok: true, handle, linked: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/already linked/i.test(message)) {
      return {
        ok: false,
        status: 409,
        error: "This handle was just claimed by another account. Pick a different handle.",
      };
    }
    return { ok: false, status: 503, error: "Profile storage is unavailable." };
  }
}
