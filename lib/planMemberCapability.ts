/**
 * Read the Plan member capability without ever serialising or logging it.
 * Authorization is canonical; the body fallback keeps existing shared-link
 * clients working while they migrate.
 */
export function planMemberCapability(request: Request, bodyToken: unknown): string | undefined {
  const authorization = request.headers.get("authorization");
  const bearer = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (bearer) return bearer;
  return typeof bodyToken === "string" && bodyToken.trim() ? bodyToken.trim() : undefined;
}
