import "server-only";

// The doors every /api/leagues route shares: a verified Social account, a rate
// limit, a JSON body, and one map from a league failure to the API envelope.

import { publicApiError } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import { withAuthResumeCookie } from "@/lib/authSessionResume";
import { LeagueStoreError } from "@/lib/leagueStore";
import { LEAGUES_COPY } from "@/lib/leagues";
import type { LeagueViewer } from "@/lib/leagues.server";
import { log } from "@/lib/log";
import { isLimited } from "@/lib/pintDrops";
import { requireVerifiedSocialActor } from "@/lib/socialAccessServer";
import { hashActor } from "@/lib/supabase";

const NO_STORE = { "Cache-Control": "private, no-store" };

export type LeagueLimit = { name: string; max: number; windowMs: number };

export type LeagueDoor =
  | { ok: true; viewer: LeagueViewer; reply: (response: Response) => Response }
  | { ok: false; response: Response };

/** The reader, once they are a verified Social account inside their rate limit. */
export async function leagueDoor(request: Request, limit: LeagueLimit): Promise<LeagueDoor> {
  const access = await requireVerifiedSocialActor(request);
  if (!access.ok) {
    return {
      ok: false,
      response: withAuthResumeCookie(publicApiError(access.error, access.code, access.status, {
        retryable: access.retryable === true,
        ...(access.gate ? { details: { gate: access.gate } } : {}),
        headers: NO_STORE,
      }), access.resumeCookie),
    };
  }
  const reply = (response: Response) => withAuthResumeCookie(response, access.resumeCookie);
  const key = `${limit.name}:${hashActor(access.actor.profileId)}`;
  if (await isLimited(key, key, limit.max, limit.windowMs)) {
    return { ok: false, response: reply(leagueError("Too many requests. Slow down.", "RATE_LIMITED", 429, true)) };
  }
  return { ok: true, viewer: { ...access.actor, authUserId: access.authUserId }, reply };
}

export function leagueJson(body: unknown, status = 200): Response {
  return jsonNoStore(body, { status, headers: NO_STORE });
}

export function leagueError(error: string, code: string, status: number, retryable = false): Response {
  return publicApiError(error, code, status, { retryable, headers: NO_STORE });
}

/** A JSON object body, or null when the body is anything else. */
export async function leagueBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const parsed: unknown = await request.json();
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export const malformedLeagueBody = () => leagueError("Malformed request body.", "MALFORMED_REQUEST", 400);

export const leagueNotFound = () => leagueError(LEAGUES_COPY.notFound, "NOT_FOUND", 404);

/** A store or read failure, as the envelope. Before migration 0239 it says leagues are not open. */
export function leagueFailure(err: unknown, route: string): Response {
  if (err instanceof LeagueStoreError) return leagueError(LEAGUES_COPY.notOpen, "LEAGUES_NOT_OPEN", 503);
  log("error", "leagues.request_failed", { route, error: err instanceof Error ? err.message : String(err) });
  return leagueError("Leagues are unavailable right now.", "LEAGUES_UNAVAILABLE", 503, true);
}
