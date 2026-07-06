import { createHash, timingSafeEqual } from "node:crypto";

// Moderator gate — the SAME contract as app/api/pint-drops/route.ts (kept in step
// intentionally; that route predates this shared helper and is owned elsewhere, so
// it keeps its inline copy). The token arrives via the `x-admin-token` header ONLY
// (never a query string — those leak through history/logs/Referer). When
// ADMIN_TOKEN is set the token must match it (constant-time compare). When it is
// unset we DENY everywhere except local dev + the test runner, so a preview deploy
// is never wide open.

// Constant-time compare: sha256 both sides so lengths always match, then
// timingSafeEqual — a plain === leaks match length/prefix via timing.
function safeTokenEqual(provided: string, expected: string): boolean {
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

export function isModerator(request: Request): boolean {
  const expected = process.env.ADMIN_TOKEN;
  const provided = request.headers.get("x-admin-token") ?? undefined;
  if (!expected) {
    return process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test";
  }
  if (!provided) return false;
  return safeTokenEqual(provided, expected);
}
