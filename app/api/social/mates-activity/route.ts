import { assertServerEnv } from "@/lib/serverEnv";
import { publicApiError } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import { withAuthResumeCookie } from "@/lib/authSessionResume";
import { log } from "@/lib/log";
import type { MatesActivityAnswer } from "@/lib/matesActivity";
import { readMatesActivity } from "@/lib/matesActivity.server";
import { isLimited } from "@/lib/pintDrops";
import { requireVerifiedSocialActor } from "@/lib/socialAccessServer";
import { hashActor } from "@/lib/supabase";

assertServerEnv();

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" };
const READ_LIMIT = 30;
const READ_WINDOW_MS = 60_000;

/**
 * GET /api/social/mates-activity delegates the activity contract to
 * readMatesActivity. See README.md's Social section for usage and visibility.
 */
export async function GET(request: Request): Promise<Response> {
  const access = await requireVerifiedSocialActor(request);
  if (!access.ok) {
    return withAuthResumeCookie(publicApiError(access.error, access.code, access.status, {
      retryable: access.retryable === true,
      headers: NO_STORE,
    }), access.resumeCookie);
  }
  const key = `mates-activity:${hashActor(access.actor.profileId)}`;
  if (await isLimited(key, key, READ_LIMIT, READ_WINDOW_MS)) {
    return withAuthResumeCookie(publicApiError("Too many requests. Slow down.", "RATE_LIMITED", 429, {
      retryable: true,
      headers: NO_STORE,
    }), access.resumeCookie);
  }
  try {
    const answer: MatesActivityAnswer = { items: await readMatesActivity(access.actor) };
    return withAuthResumeCookie(jsonNoStore(answer, { headers: NO_STORE }), access.resumeCookie);
  } catch (err) {
    log("error", "mates_activity.read_failed", {
      route: "GET /api/social/mates-activity",
      error: err instanceof Error ? err.message : String(err),
    });
    return withAuthResumeCookie(publicApiError("Your mates' pints are unavailable right now.", "MATES_ACTIVITY_UNAVAILABLE", 503, {
      retryable: true,
      headers: NO_STORE,
    }), access.resumeCookie);
  }
}
