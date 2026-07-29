import type { Session } from "@supabase/supabase-js";

import {
  accountBoundFetch,
  captureAccountAuth,
  type AccountBoundRequest,
} from "@/lib/accountBoundFetch";
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
