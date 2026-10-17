import { PLAN_HTTP_ONLY_SESSION } from "@/lib/planSessionCapability";

/**
 * Read the Plan member capability without ever serialising or logging it.
 * Authorization is canonical; the body fallback keeps existing shared-link
 * clients working while they migrate.
 */
export function planMemberCapability(request: Request, bodyToken: unknown): string | undefined {
  const authorization = request.headers.get("authorization");
  const bearer = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (bearer && bearer !== PLAN_HTTP_ONLY_SESSION) return bearer;
  const planId = new URL(request.url).pathname.match(/^\/api\/plans\/([0-9a-f-]{36})(?:\/|$)/i)?.[1];
  if (planId) {
    const cookieToken = planMemberCookieCapability(request, planId);
    if (cookieToken) return cookieToken;
  }
  return typeof bodyToken === "string" && bodyToken.trim() && bodyToken !== PLAN_HTTP_ONLY_SESSION ? bodyToken.trim() : undefined;
}

export function planMemberCookieName(planId: string): string {
  return `pubmax_plan_member_${planId}`;
}

/** Read only the script-inaccessible Plan member cookie, never an auth bearer. */
export function planMemberCookieCapability(
  request: Request,
  planId: string,
): string | undefined {
  const cookieName = planMemberCookieName(planId);
  const rawCookie = request.headers
    .get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${cookieName}=`));
  if (!rawCookie) return undefined;
  try {
    const token = decodeURIComponent(rawCookie.slice(cookieName.length + 1));
    return token || undefined;
  } catch {
    return undefined;
  }
}

/**
 * How long the member cookie outlives the process that set it (#1540).
 *
 * A cookie with no Max-Age is a SESSION cookie, and a native WebView drops
 * every session cookie when its process dies. A host who made a Plan and then
 * cold-started the app on its link (a notification, a message, the App Link)
 * arrived with no capability, and a signed-out host has no other lane back:
 * the account recovery PATCH needs a session. The page then showed the host
 * the invitee teaser on their own plan. Thirty days covers the 14-day start
 * horizon (`lib/planGenerationIntake.ts`), the night and the recap after it,
 * and matches the auth resume cookie, which carries more authority than this.
 * The cookie stays HttpOnly and path-scoped to this Plan's API.
 */
export const PLAN_MEMBER_SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

/** Attach a path-scoped, script-inaccessible recovery session to create/join. */
export function attachPlanMemberSession(response: Response, request: Request, planId: string, token: string): Response {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  response.headers.append(
    "Set-Cookie",
    `${planMemberCookieName(planId)}=${encodeURIComponent(token)}; Path=/api/plans/${planId}; HttpOnly; SameSite=Lax; Max-Age=${PLAN_MEMBER_SESSION_MAX_AGE_SECONDS}${secure}`,
  );
  return response;
}
