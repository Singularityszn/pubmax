// Reader report lane for owned profile avatars (Social Launch WP4).
//
//   POST { reason? } -> 200 { ok: true }
//
// A flag queues the face for a human moderator. It never auto-hides and never
// deletes storage or provenance. The reporter actor is server-derived from the
// request origin (same shape as visit-reports) so one client cannot mint many
// distinct reporters via a body token.

import { publicApiError } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import { log } from "@/lib/log";
import { isLimited } from "@/lib/pintDrops";
import { normalizeHandle } from "@/lib/profiles";
import { reportProfileAvatar } from "@/lib/profileStore";
import { assertServerEnv } from "@/lib/serverEnv";
import { clientIp, hashActor, hashIp } from "@/lib/supabase";
import { readString } from "@/lib/textClean";

assertServerEnv();

const REPORT_PER_ACTOR_LIMIT = 1;

type RouteContext = { params: Promise<{ handle: string }> };

async function parseJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const { handle: rawHandle } = await context.params;
  const handle = normalizeHandle(rawHandle);
  if (!handle) {
    return publicApiError("Profile not found.", "NOT_FOUND", 404);
  }

  const body = await parseJson(request);
  if (!body) {
    return publicApiError("Malformed request body.", "MALFORMED_REQUEST", 400);
  }

  // Server-derived reporter: a body-supplied actor would let one origin inflate
  // the queue with fake distinct voices.
  const actorHash = hashActor(`profile-avatar:${hashIp(clientIp(request))}`);
  if (
    (await isLimited(`profile-avatar-report:${handle}`, `profile-avatar-report:${handle}`)) ||
    (await isLimited(
      `profile-avatar-report:${handle}:${actorHash}`,
      `profile-avatar-report:${handle}:${actorHash}`,
      REPORT_PER_ACTOR_LIMIT,
    ))
  ) {
    return publicApiError("Too many reports, slow down.", "RATE_LIMITED", 429, { retryable: true });
  }

  try {
    const done = await reportProfileAvatar(handle, readString(body.reason), actorHash);
    return done
      ? jsonNoStore({ ok: true }, { status: 200 })
      : publicApiError("Profile avatar not found.", "NOT_FOUND", 404);
  } catch (err) {
    log("error", "profile_avatar.report_failed", {
      route: "POST /api/profiles/[handle]/avatar/report",
      error: err instanceof Error ? err.message : String(err),
    });
    return publicApiError("Storage is unavailable.", "STORE_UNAVAILABLE", 503, { retryable: true });
  }
}
