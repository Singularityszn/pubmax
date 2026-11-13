import { assertServerEnv } from "@/lib/serverEnv";
import { publicApiError } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import { withAuthResumeCookie } from "@/lib/authSessionResume";
import { log } from "@/lib/log";
import { readMatesBoard } from "@/lib/matesBoard.server";
import { isLimited } from "@/lib/pintDrops";
import { requireVerifiedSocialActor } from "@/lib/socialAccessServer";
import { hashActor } from "@/lib/supabase";

assertServerEnv();

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" };
const READ_LIMIT = 10;
const READ_WINDOW_MS = 60_000;

/**
 * GET /api/social/mates-board: the reader and their mutual mates, each with
 * their points all time and this month, answered to the reader alone. A reader
 * with no verified Social session gets the access answer (401 signed out).
 */
export async function GET(request: Request): Promise<Response> {
  const access = await requireVerifiedSocialActor(request);
  if (!access.ok) {
    return withAuthResumeCookie(publicApiError(access.error, access.code, access.status, {
      retryable: access.retryable === true,
      headers: NO_STORE,
    }), access.resumeCookie);
  }
  const key = `mates-board:${hashActor(access.actor.profileId)}`;
  if (await isLimited(key, key, READ_LIMIT, READ_WINDOW_MS)) {
    return withAuthResumeCookie(publicApiError("Too many requests. Slow down.", "RATE_LIMITED", 429, {
      retryable: true,
      headers: NO_STORE,
    }), access.resumeCookie);
  }
  try {
    const answer = await readMatesBoard(access.actor, new Date());
    return withAuthResumeCookie(jsonNoStore(answer, { headers: NO_STORE }), access.resumeCookie);
  } catch (err) {
    log("error", "mates_board.read_failed", {
      route: "GET /api/social/mates-board",
      error: err instanceof Error ? err.message : String(err),
    });
    return withAuthResumeCookie(publicApiError("The board is unavailable right now.", "MATES_BOARD_UNAVAILABLE", 503, {
      retryable: true,
      headers: NO_STORE,
    }), access.resumeCookie);
  }
}
