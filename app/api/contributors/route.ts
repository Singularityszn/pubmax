// The public contributor leaderboard.
//
// NEVER HELD AT THE EDGE: the board is moderation state as much as it is a
// ranking. A contributor banned, withdrawn or suspended a minute ago must leave
// it on the next read, and an edge copy would keep their handle, avatar and
// counts public until it expired (`jsonCached` is for bundled data only).
//
// A per-address budget sits in front of it instead, the same one the founders
// wall spends, because every answer is a full ranking read.
//
// Avatars are a garnish. If the avatar lookup throws, the board still answers,
// without them, instead of a bare 500.

import { publicApiError } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
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

  return jsonNoStore(answer, { status: 200 });
}
