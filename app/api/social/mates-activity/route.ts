import { assertServerEnv } from "@/lib/serverEnv";
import { publicApiError } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
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
 * GET /api/social/mates-activity: the newest pints the reader's mutual friends
 * logged, read live and answered to the reader alone. A reader with no verified
 * Social session gets the access answer (401 signed out). A reader with no
 * mates, or whose mates have logged nothing, gets an empty list.
 */
export async function GET(request: Request): Promise<Response> {
  const access = await requireVerifiedSocialActor(request);
  if (!access.ok) {
    return publicApiError(access.error, access.code, access.status, {
      retryable: access.retryable === true,
      headers: NO_STORE,
    });
  }
  const key = `mates-activity:${hashActor(access.actor.profileId)}`;
  if (await isLimited(key, key, READ_LIMIT, READ_WINDOW_MS)) {
    return publicApiError("Too many requests. Slow down.", "RATE_LIMITED", 429, {
      retryable: true,
      headers: NO_STORE,
    });
  }
  try {
    const answer: MatesActivityAnswer = { items: await readMatesActivity(access.actor) };
    return jsonNoStore(answer, { headers: NO_STORE });
  } catch (err) {
    log("error", "mates_activity.read_failed", {
      route: "GET /api/social/mates-activity",
      error: err instanceof Error ? err.message : String(err),
    });
    return publicApiError("Your mates' pints are unavailable right now.", "MATES_ACTIVITY_UNAVAILABLE", 503, {
      retryable: true,
      headers: NO_STORE,
    });
  }
}
