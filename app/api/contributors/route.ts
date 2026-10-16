// The public contributor leaderboard.
//
// ONE ANSWER FOR EVERYBODY: the board reads no session and no caller, so a
// ready board is held at the edge for a minute, and the unbounded leaderboard
// RPC behind it runs at most once a minute per edge region rather than once
// per page view. A degraded board is never held: it says "we could not
// check", and the next request should check again.
//
// A per-address budget sits in front of it all, the same one the founders
// wall spends, because a cache miss is still a full ranking read.
//
// Avatars are a garnish. If the avatar lookup throws, the board still answers,
// without them, instead of a bare 500.

import { publicApiError } from "@/lib/apiError";
import { jsonCached, jsonNoStore } from "@/lib/apiResponses";
import {
  enrichContributorBoard,
  readContributorLeaderboard,
} from "@/lib/contributorLeaderboardStore";
import { log } from "@/lib/log";
import { isLimited } from "@/lib/pintDrops";
import { clientIp, hashIp } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const READ_LIMIT = 60;
const READ_WINDOW_MS = 60_000;
const BOARD_EDGE_MAX_AGE_SECONDS = 60;
const BOARD_STALE_WHILE_REVALIDATE_SECONDS = 300;

export async function GET(request: Request): Promise<Response> {
  const limiterKey = `contributors:${hashIp(clientIp(request))}`;
  if (await isLimited(limiterKey, limiterKey, READ_LIMIT, READ_WINDOW_MS)) {
    return publicApiError("Too many requests, slow down.", "RATE_LIMITED", 429, {
      retryable: true,
    });
  }

  const board = await readContributorLeaderboard();
  let answer = board;
  try {
    answer = await enrichContributorBoard(board);
  } catch (err) {
    log("warn", "contributors.enrich_failed", {
      route: "GET /api/contributors",
      error: err instanceof Error ? err.message : String(err),
    });
  }

  if (answer.status !== "ready") return jsonNoStore(answer, { status: 200 });
  return jsonCached(answer, {
    status: 200,
    sMaxAge: BOARD_EDGE_MAX_AGE_SECONDS,
    staleWhileRevalidate: BOARD_STALE_WHILE_REVALIDATE_SECONDS,
  });
}
