import type { Session } from "@supabase/supabase-js";

import {
  accountBoundFetch,
  captureAccountAuth,
  type AccountBoundRequest,
} from "@/lib/accountBoundFetch";
import { HANDLE_CLAIM_NEXT } from "@/lib/authRedirect";
import { normalizeHandle } from "@/lib/profiles";
import { clearClaimedRoundAnonymousHandle } from "@/lib/roundRequest";

export const IDENTITY_HANDLE_CHANGED_EVENT = "pubmaxx:identity-handle-changed";

export type IdentityHandleChangedDetail = Readonly<{
  ownerId: string;
  handle: string;
}>;

export type CanonicalIdentityResolution =
  | Readonly<{ ok: false }>
  | Readonly<{
      ok: true;
      identity: IdentityHandleChangedDetail | null;
    }>;

export function identityHandleForOwner(
  detail: unknown,
  ownerId: string | null,
): string | null {
  if (!ownerId || !detail || typeof detail !== "object") return null;
  const candidate = detail as { ownerId?: unknown; handle?: unknown };
  return candidate.ownerId === ownerId && typeof candidate.handle === "string"
    ? candidate.handle
    : null;
}

export function emitIdentityHandleChanged(
  detail: IdentityHandleChangedDetail,
): void {
  if (typeof window === "undefined") return;
  let storage: Storage | null = null;
  try {
    storage = window.localStorage;
  } catch {}
  clearClaimedRoundAnonymousHandle(detail.handle, storage);
  window.dispatchEvent(
    new CustomEvent(IDENTITY_HANDLE_CHANGED_EVENT, { detail }),
  );
}

export async function resolveCanonicalIdentity(
  expectedUserId: string,
  session: Pick<Session, "access_token" | "user"> | null,
  storage: Pick<Storage, "getItem" | "removeItem"> | null,
  request: AccountBoundRequest = fetch,
): Promise<CanonicalIdentityResolution> {
  const auth = captureAccountAuth(expectedUserId, session);
  if (!auth) return { ok: false };
  const response = await accountBoundFetch(
    auth,
    "/api/identity/handle/current",
    {},
    request,
  );
  if (!response.ok) return { ok: false };
  const body = await response.json().catch(() => null) as {
    handle?: unknown;
  } | null;
  const handle =
    typeof body?.handle === "string" ? normalizeHandle(body.handle) : "";
  if (!handle) return { ok: true, identity: null };
  clearClaimedRoundAnonymousHandle(handle, storage);
  return {
    ok: true,
    identity: { ownerId: auth.userId, handle },
  };
}

// App-wide device-handle convention shared with the composers and /u/you.
const DEVICE_HANDLE_KEY = "pubmax_handle";

/**
 * Post-callback routing. Creating the account comes first and choosing a
 * handle is the step after, and /u/you is the only surface carrying the claim
 * form, so a freshly established session with no claimed handle routes there.
 * Returns the destination path, or null to stay put. Never bounces the user on
 * doubt: a restored return fragment (an invite) owns the destination, a device
 * handle means /u/you would just redirect back out, and a failed or unreadable
 * server answer is not evidence the account has no handle.
 */
export async function handleClaimRouteAfterSignIn(
  session: Pick<Session, "access_token" | "user"> | null,
  landedUrl: string,
  storage: Pick<Storage, "getItem" | "removeItem"> | null,
  request: AccountBoundRequest = fetch,
): Promise<string | null> {
  const userId = session?.user?.id;
  if (!userId) return null;
  try {
    const landed = new URL(landedUrl, "https://pubmax.invalid");
    if (landed.hash) return null;
    if (landed.pathname === HANDLE_CLAIM_NEXT) return null;
  } catch {
    return null;
  }
  try {
    if (storage && normalizeHandle(storage.getItem(DEVICE_HANDLE_KEY) ?? "")) {
      return null;
    }
  } catch {
    // Unreadable storage answers nothing; the server read below decides.
  }
  const resolution = await resolveCanonicalIdentity(
    userId,
    session,
    storage,
    request,
  ).catch(() => null);
  if (!resolution?.ok || resolution.identity) return null;
  return HANDLE_CLAIM_NEXT;
}
