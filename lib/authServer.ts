// Server-side identity resolution for API routes.
//
// Writes in this app route through the SERVICE-ROLE admin client, which bypasses
// RLS — so ownership can't be enforced by RLS on those writes. Instead a route
// resolves the caller's VERIFIED identity here and enforces ownership itself
// (see lib/profileOwnership.ts + app/api/profiles/[handle]/route.ts).
//
// A request proves identity by sending its Supabase access token as
// `Authorization: Bearer <jwt>`. We verify it by asking Supabase who it belongs
// to (auth.getUser(jwt)) using the admin client — this validates the signature +
// expiry server-side, so a forged/expired token yields null (anonymous), never a
// trusted uid. NEVER trust a uid sent in the body/query; only a verified token.

import { getSupabaseAdmin } from "@/lib/supabase";

/** Extract a bearer token from an Authorization header, or null when absent. */
export function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization") ?? request.headers.get("Authorization");
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  const token = match?.[1]?.trim();
  return token ? token : null;
}

/**
 * Resolve the caller's authenticated user id from their request, or null when
 * the request is anonymous / the token is invalid / auth is unconfigured.
 *
 * Fail-CLOSED for identity: any doubt (no token, bad token, no admin client, a
 * verification error) resolves to null. A null caller can still take the
 * anonymous demo path for an UNLINKED handle, but can never satisfy the owner
 * check for a LINKED one — so an invalid token can't impersonate an owner.
 */
export async function callerUserId(request: Request): Promise<string | null> {
  const identity = await callerAuthIdentity(request);
  return identity?.id ?? null;
}

export type CallerAuthIdentity = {
  id: string;
  /** Verified email from the JWT user, or null when absent. */
  email: string | null;
};

export type CallerAuthSessionIdentity = CallerAuthIdentity & {
  /** Verified Supabase auth-session id from the same JWT. */
  sessionId: string;
};

function sessionIdFromVerifiedJwt(token: string): string | null {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      session_id?: unknown;
    };
    const sessionId = typeof parsed.session_id === "string" ? parsed.session_id : "";
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sessionId)
      ? sessionId
      : null;
  } catch {
    return null;
  }
}

/**
 * Resolve account and auth-session authority from one verified bearer JWT.
 * Routes that need ordering across logout use the session id as a tombstone
 * key, preventing a delayed POST from that logged-out session from relinking.
 */
export async function callerAuthSessionIdentity(
  request: Request,
): Promise<CallerAuthSessionIdentity | null> {
  const token = bearerToken(request);
  if (!token) return null;

  const admin = getSupabaseAdmin();
  if (!admin) return null;

  try {
    const { data, error } = await admin.auth.getUser(token);
    if (error) return null;
    const id = data.user?.id;
    const sessionId = sessionIdFromVerifiedJwt(token);
    if (typeof id !== "string" || !id || !sessionId) return null;
    const email = typeof data.user?.email === "string" ? data.user.email : null;
    return { id, email, sessionId };
  } catch {
    return null;
  }
}

/**
 * Resolve the caller's verified id + email from their bearer JWT, or null when
 * anonymous / invalid / unconfigured. Same fail-closed rules as callerUserId.
 * Prefer this when a route must derive an auth handle from the account email
 * (never trust a client-supplied authHandle).
 */
export async function callerAuthIdentity(
  request: Request,
): Promise<CallerAuthIdentity | null> {
  const token = bearerToken(request);
  if (!token) return null;

  const admin = getSupabaseAdmin();
  if (!admin) return null;

  try {
    const { data, error } = await admin.auth.getUser(token);
    if (error) return null;
    const id = data.user?.id;
    if (typeof id !== "string" || !id) return null;
    const email = typeof data.user?.email === "string" ? data.user.email : null;
    return { id, email };
  } catch {
    return null;
  }
}
