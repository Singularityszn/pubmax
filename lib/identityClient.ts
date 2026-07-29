export const IDENTITY_HANDLE_CHANGED_EVENT = "pubmaxx:identity-handle-changed";

export type IdentityHandleChangedDetail = Readonly<{
  ownerId: string;
  handle: string;
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
  window.dispatchEvent(
    new CustomEvent(IDENTITY_HANDLE_CHANGED_EVENT, { detail }),
  );
}
