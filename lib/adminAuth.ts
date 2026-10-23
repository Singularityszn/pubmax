import "server-only";

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { isCrossSiteRequest } from "@/lib/crossSiteRequest";
import { log } from "@/lib/log";

// Moderator gate — shared by app/api/admin/comments/route.ts and the moderator
// branches of app/api/pint-drops/route.ts. The token may arrive via the
// `x-admin-token` header (backwards compat during transition) OR an httpOnly
// session cookie set by POST /api/admin/session. Query-string tokens are never
// accepted — those leak through history/logs/Referer. When ADMIN_TOKEN is set the
// credential must match it (constant-time compare). When it is unset we DENY
// everywhere except local dev + the test runner, so a preview deploy is never
// wide open.

export const ADMIN_SESSION_COOKIE = "pubmax_admin_session";
const SOCIAL_MODERATOR_STAFF_ROLE_ID_ENV = "SOCIAL_MODERATOR_STAFF_ROLE_ID";

// 24h — long enough for a moderation shift, short enough to limit stolen-cookie
// exposure. Refreshed on each successful POST /api/admin/session.
export const ADMIN_SESSION_MAX_AGE_SEC = 60 * 60 * 24;

// ADMIN_TOKEN is both the header credential and the HMAC key for admin
// sessions, so Vercel Production holds it to the same 32 bytes as the other
// signing secrets (LIB-S6). A short token closes the moderator door rather
// than failing the boot: the public app stays up, every admin credential is
// refused, and one error line says why. Keyed on VERCEL_ENV alone because CI
// bakes NODE_ENV=production into the test runner.
const MIN_PRODUCTION_ADMIN_TOKEN_BYTES = 32;
let shortAdminTokenLogged = false;

function adminTokenTooShort(token: string): boolean {
  if (process.env.VERCEL_ENV !== "production") return false;
  if (Buffer.byteLength(token.trim(), "utf8") >= MIN_PRODUCTION_ADMIN_TOKEN_BYTES) return false;
  if (!shortAdminTokenLogged) {
    shortAdminTokenLogged = true;
    log("error", "admin_auth.token_too_short", { minBytes: MIN_PRODUCTION_ADMIN_TOKEN_BYTES });
  }
  return true;
}

// Constant-time compare: sha256 both sides so lengths always match, then
// timingSafeEqual — a plain === leaks match length/prefix via timing.
function safeTokenEqual(provided: string, expected: string): boolean {
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

/** Versioned session: the signed issuance time bounds replay on the server. */
export function mintAdminSession(token: string): string {
  const payload = `v1.${Math.floor(Date.now() / 1000)}`;
  return `${payload}.${createHmac("sha256", token).update(payload).digest("hex")}`;
}

function validAdminSession(value: string, token: string): boolean {
  const match = /^(v1\.([0-9]{1,12}))\.([a-f0-9]{64})$/.exec(value);
  if (!match) return false;
  const [, payload, issuedAtText, signatureHex] = match;
  if (payload === undefined || issuedAtText === undefined || signatureHex === undefined) return false;
  const issuedAt = Number(issuedAtText);
  const now = Math.floor(Date.now() / 1000);
  if (issuedAt > now || now - issuedAt >= ADMIN_SESSION_MAX_AGE_SEC) return false;
  const signature = createHmac("sha256", token).update(payload).digest("hex");
  return safeTokenEqual(signatureHex, signature);
}

// The two credentials are read off a header list, never off a whole Request:
// the moderator document gate is handed Next's own sealed header adapter, and
// only `get` is part of that contract.
type ModeratorHeaders = Pick<Headers, "get">;

function readAdminSessionCookie(headerList: ModeratorHeaders): string | undefined {
  const raw = headerList.get("cookie");
  if (!raw) return undefined;
  for (const part of raw.split(";")) {
    const trimmed = part.trim();
    if (trimmed.startsWith(`${ADMIN_SESSION_COOKIE}=`)) {
      try {
        return decodeURIComponent(trimmed.slice(ADMIN_SESSION_COOKIE.length + 1));
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

/**
 * Whether GET /admin may render the moderator console. Same credential as the
 * API gate: a missing session is a refusal, never a 200 shell.
 */
export function canOpenAdminDocument(headerList: ModeratorHeaders): boolean {
  return hasModeratorCredential(headerList);
}

/**
 * The API gate. A browser attaches the session cookie to a cross-site request
 * too (SameSite=Lax still sends it on a top-level POST form), so a cookie
 * credential on a WRITE from another site is refused: that is the CSRF shape.
 * The `x-admin-token` header cannot be set by another site, so it is unaffected.
 */
export function isModerator(request: Request): boolean {
  const credential = moderatorCredential(request.headers);
  if (credential !== "cookie") return credential !== null;
  const method = (request.method ?? "GET").toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return true;
  return !isCrossSiteRequest(request);
}

/**
 * Resolve the named Social moderator bound to the existing admin credential.
 * The role id is deployment configuration, never client input. The migration
 * checks that this role is still active and has moderator role before any
 * queue read or moderation write.
 */
export function moderatorStaffRoleId(request: Request): string | null {
  if (!isModerator(request)) return null;
  const roleId = process.env[SOCIAL_MODERATOR_STAFF_ROLE_ID_ENV]?.trim() ?? "";
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(roleId)
    ? roleId
    : null;
}

function hasModeratorCredential(headerList: ModeratorHeaders): boolean {
  return moderatorCredential(headerList) !== null;
}

/** Which credential admitted the caller, or null when none did. */
function moderatorCredential(headerList: ModeratorHeaders): "local" | "header" | "cookie" | null {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected) {
    return process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test"
      ? "local"
      : null;
  }
  if (adminTokenTooShort(expected)) return null;

  const headerToken = headerList.get("x-admin-token") ?? undefined;
  if (headerToken && safeTokenEqual(headerToken, expected)) return "header";

  const sessionValue = readAdminSessionCookie(headerList);
  if (sessionValue && validAdminSession(sessionValue, expected)) return "cookie";

  return null;
}

export function verifyAdminToken(token: string): boolean {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected) {
    return process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test";
  }
  if (adminTokenTooShort(expected)) return false;
  return safeTokenEqual(token, expected);
}
