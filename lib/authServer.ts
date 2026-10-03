import "server-only";

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
//
// THE DEFAULT ASKS THE AUTH SERVER, BECAUSE REVOCATION IS A FACT ABOUT THE
// ACCOUNT AND NOT ABOUT THE TOKEN. `getClaims` checks a signature and an `exp`
// against the project JWKS and NOTHING ELSE, so a token whose account has been
// deleted or banned still verifies for the rest of its hour. #1501 made that
// local lane the default to spare a messaging poll a round trip; review finding
// F-3 measured what it cost. Every gate that reads a live account — the
// contribution gate on every price write, the Social 18+ gate, the two plan-seat
// claims and the session refresh — was answering yes to an account that had just
// deleted itself. And the messaging routes it was written for never took the
// saving anyway: `lib/messageAuth.ts` asks `callerUserId`, which needs account
// metadata and has always asked GoTrue.
//
// ONE caller opts out, and it is the one door that MUST answer after the
// account is gone: `DELETE /api/account` passes `{ localOnly: true }` so a
// second delete reaches its documented 410 rather than a 401 about an account
// we know the caller owns. That argument is written at the call site.

import { isAuthUserBannedUntil, isGoTrueUserBannedError } from "@/lib/authAccountBan";
import { getSupabaseAdmin } from "@/lib/supabase";

/**
 * Extract a bearer token from an Authorization header, or null when absent.
 *
 * @public Read through `importOriginal()` by
 * __tests__/permissionMatrixEffective.test.ts, which builds its identity
 * stub out of the real header parse. Knip cannot follow a namespace read
 * taken from a dynamic `typeof import()`, so the tag stands in for the
 * caller: drop the export keyword and typecheck goes red on that spec.
 */
export function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization") ?? request.headers.get("Authorization");
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  const token = match?.[1]?.trim();
  return token ? token : null;
}

export type CallerAuthIdentity = {
  id: string;
  /** Verified email from the JWT user, or null when absent. */
  email: string | null;
  /** Supabase Auth account creation time, used for signup-only attribution. */
  createdAt: string | null;
};

export type CallerAuthVerification =
  | { status: "absent" }
  | { status: "invalid" }
  | { status: "banned" }
  | { status: "unavailable" }
  | { status: "verified"; identity: CallerAuthIdentity };

const INVALID_BEARER_CODES = new Set([
  "bad_jwt",
  "invalid_jwt",
  "no_authorization",
  "session_expired",
  "session_not_found",
  "unexpected_audience",
  "user_not_found",
]);

const INVALID_BEARER_ERROR_NAMES = new Set([
  "AuthInvalidJwtError",
  "AuthSessionMissingError",
]);

function isInvalidBearerError(error: unknown): boolean {
  if (isGoTrueUserBannedError(error)) return false;
  if (!error || typeof error !== "object") return false;
  const candidate = error as {
    code?: unknown;
    name?: unknown;
    status?: unknown;
  };
  if (candidate.status === 401) return true;
  if (
    typeof candidate.name === "string" &&
    INVALID_BEARER_ERROR_NAMES.has(candidate.name)
  ) {
    return true;
  }
  return (
    typeof candidate.code === "string" &&
    INVALID_BEARER_CODES.has(candidate.code)
  );
}

export type VerifyCallerAuthOptions = Readonly<{
  /**
   * Verify the token HERE against the project JWKS rather than asking GoTrue
   * who it belongs to.
   *
   * It is faster and it is weaker: a locally verified token says the signature
   * and the expiry are good and says nothing about whether the account still
   * exists. Pass it only where the answer must survive the account's own
   * deletion — `DELETE /api/account` is the whole list — and say why at the
   * call site. Every other caller wants revocation.
   */
  localOnly?: boolean;
}>;

/**
 * Verify the bearer locally against the project JWKS, for the one caller that
 * asked for it.
 *
 * `getClaims` checks the signature (against a JWKS fetched once per process and
 * cached by supabase-js) and the expiry, so an ES256 token is verified in
 * microseconds with nothing on the wire. Where the project still signs HS256,
 * supabase-js falls back to `getUser` inside `getClaims`, so an HS256 project
 * gets the account check back for free. Nothing here trusts a claim it did not
 * verify — but nothing here asks whether the account is still there either,
 * which is why it is opt-in. Returns null when the client cannot answer
 * locally at all, and the caller falls through to GoTrue.
 */
async function verifyClaimsLocally(
  admin: NonNullable<ReturnType<typeof getSupabaseAdmin>>,
  token: string,
): Promise<CallerAuthVerification | null> {
  const auth = admin.auth as {
    getClaims?: (
      jwt: string,
    ) => Promise<{
      data: { claims: { sub?: unknown; email?: unknown } } | null;
      error: unknown;
    }>;
  };
  if (typeof auth.getClaims !== "function") return null;
  const { data, error } = await auth.getClaims(token);
  if (error) {
    if (isGoTrueUserBannedError(error)) return { status: "banned" };
    return { status: isInvalidBearerError(error) ? "invalid" : "unavailable" };
  }
  const id = data?.claims?.sub;
  if (typeof id !== "string" || !id) return { status: "invalid" };
  const email = typeof data.claims.email === "string" ? data.claims.email : null;
  return { status: "verified", identity: { id, email, createdAt: null } };
}

export async function verifyCallerAuth(
  request: Request,
  options: VerifyCallerAuthOptions = {},
): Promise<CallerAuthVerification> {
  const token = bearerToken(request);
  if (!token) return { status: "absent" };

  const admin = getSupabaseAdmin();
  if (!admin) return { status: "unavailable" };

  try {
    if (options.localOnly) {
      const local = await verifyClaimsLocally(admin, token);
      if (local) return local;
    }
    const { data, error } = await admin.auth.getUser(token);
    if (error) {
      if (isGoTrueUserBannedError(error)) return { status: "banned" };
      return {
        status: isInvalidBearerError(error) ? "invalid" : "unavailable",
      };
    }
    const id = data.user?.id;
    if (typeof id !== "string" || !id) return { status: "invalid" };
    if (isAuthUserBannedUntil(data.user)) return { status: "banned" };
    const email = typeof data.user?.email === "string" ? data.user.email : null;
    const createdAt =
      typeof data.user?.created_at === "string" ? data.user.created_at : null;
    return {
      status: "verified",
      identity: { id, email, createdAt },
    };
  } catch {
    return { status: "unavailable" };
  }
}

/**
 * One verification per Request. `resolveMessageHandle` and `gateHandleAction`
 * (and any other caller on that same object) share the in-flight promise, so
 * a signed-in route asks `auth.getUser` once. The settled answer, including a
 * failure, stays with that Request. The next Request verifies again.
 *
 * Fail-CLOSED for identity: any doubt (no token, bad token, no admin client, a
 * verification error) resolves to null. A null caller can still take the
 * anonymous demo path for an UNLINKED handle, but can never satisfy the owner
 * check for a LINKED one — so an invalid token can't impersonate an owner.
 */
const callerUserIdByRequest = new WeakMap<Request, Promise<string | null>>();

export function callerUserId(request: Request): Promise<string | null> {
  const cached = callerUserIdByRequest.get(request);
  if (cached) return cached;
  const pending = callerAuthIdentity(request).then((identity) => identity?.id ?? null);
  callerUserIdByRequest.set(request, pending);
  return pending;
}

/**
 * Resolve the caller's verified id, email, and account creation time from their
 * bearer JWT, or null when anonymous / invalid / unconfigured. Same fail-closed
 * rules as callerUserId. Prefer this when a route needs JWT-owned account
 * metadata rather than a client-supplied proxy.
 *
 * `createdAt` is not in the JWT, so this lane has always asked GoTrue; it now
 * simply takes the default and passes no option at all.
 */
export async function callerAuthIdentity(
  request: Request,
): Promise<CallerAuthIdentity | null> {
  const verification = await verifyCallerAuth(request);
  return verification.status === "verified"
    ? verification.identity
    : null;
}
