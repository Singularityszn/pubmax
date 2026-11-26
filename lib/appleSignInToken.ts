/** A Sign in with Apple token that account deletion can revoke. Apple's revoke endpoint takes either kind. */
export type AppleToken = { value: string; type: "refresh_token" | "access_token" };

const MAX_TOKEN_LENGTH = 4096;

/** The `appleToken` a `DELETE /api/account` body carries, or null for any other shape. */
export function appleTokenFromBody(body: unknown): AppleToken | null {
  if (!body || typeof body !== "object") return null;
  const token = (body as { appleToken?: unknown }).appleToken;
  if (!token || typeof token !== "object") return null;
  const { value, type } = token as { value?: unknown; type?: unknown };
  if (type !== "refresh_token" && type !== "access_token") return null;
  if (typeof value !== "string" || !value || value.length > MAX_TOKEN_LENGTH || /\s/.test(value)) return null;
  return { value, type };
}
