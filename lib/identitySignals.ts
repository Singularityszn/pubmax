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
