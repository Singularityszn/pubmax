import { createHash, timingSafeEqual } from "node:crypto";

// Moderator gate — shared by app/api/admin/comments/route.ts and the moderator
// branches of app/api/pint-drops/route.ts. The token may arrive via the
// `x-admin-token` header (backwards compat during transition) OR an httpOnly
// session cookie set by POST /api/admin/session. Query-string tokens are never
// accepted — those leak through history/logs/Referer. When ADMIN_TOKEN is set the
// credential must match it (constant-time compare). When it is unset we DENY
// everywhere except local dev + the test runner, so a preview deploy is never
// wide open.

export const ADMIN_SESSION_COOKIE = "pubmax_admin_session";

// 24h — long enough for a moderation shift, short enough to limit stolen-cookie
// exposure. Refreshed on each successful POST /api/admin/session.
export const ADMIN_SESSION_MAX_AGE_SEC = 60 * 60 * 24;

// Constant-time compare: sha256 both sides so lengths always match, then
// timingSafeEqual — a plain === leaks match length/prefix via timing.
function safeTokenEqual(provided: string, expected: string): boolean {
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

/** Hex digest stored in the session cookie — never the raw ADMIN_TOKEN. */
export function hashAdminSession(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function readAdminSessionCookie(request: Request): string | undefined {
  const raw = request.headers.get("cookie");
  if (!raw) return undefined;
  for (const part of raw.split(";")) {
    const trimmed = part.trim();
    if (trimmed.startsWith(`${ADMIN_SESSION_COOKIE}=`)) {
      return decodeURIComponent(trimmed.slice(ADMIN_SESSION_COOKIE.length + 1));
    }
  }
  return undefined;
}

/** Rebuild a Request so the document gate can reuse `isModerator`. */
export function requestFromIncomingHeaders(headerList: Headers): Request {
  return new Request("http://localhost/admin", { headers: headerList });
}

/**
 * Whether GET /admin may render the moderator console. Same credential as the
 * API gate: a missing session is a refusal, never a 200 shell.
 */
export function canOpenAdminDocument(request: Request): boolean {
  return isModerator(request);
}

export function isModerator(request: Request): boolean {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected) {
    return process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test";
  }

  const headerToken = request.headers.get("x-admin-token") ?? undefined;
  if (headerToken && safeTokenEqual(headerToken, expected)) return true;

  const sessionValue = readAdminSessionCookie(request);
  if (sessionValue && safeTokenEqual(sessionValue, hashAdminSession(expected))) return true;

  return false;
}

export function verifyAdminToken(token: string): boolean {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected) {
    return process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test";
  }
  return safeTokenEqual(token, expected);
}
