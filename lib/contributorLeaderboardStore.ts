// Server-only read seam for the public contributor record. The durable store
// owns the complete identity-backed all-time aggregate; keyless mode cannot.

import {
  rankContributors,
  rankContributorTallies,
  type ContributorLeaderboard,
  type ContributorLeaderboardTally,
} from "@/lib/contributorLeaderboard";
import { normalizeHandle } from "@/lib/profiles";
import {
  isSupabaseConfigured,
  requireSupabaseAdmin,
} from "@/lib/supabase";

type DurableLeaderboardRow = {
  handle?: unknown;
  prices?: unknown;
  reviews?: unknown;
  recommendations?: unknown;
  total?: unknown;
};

function count(value: unknown): number | null {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN;
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function durableBoard(rows: unknown): ContributorLeaderboard {
  if (!Array.isArray(rows)) {
    return rankContributors([], "degraded");
  }
  const tallies: ContributorLeaderboardTally[] = [];
  for (const raw of rows) {
    if (!raw || typeof raw !== "object") {
      return rankContributors([], "degraded");
    }
    const row = raw as DurableLeaderboardRow;
    const handle = normalizeHandle(
      typeof row.handle === "string" ? row.handle : "",
    );
    const prices = count(row.prices);
    const reviews = count(row.reviews);
    const recommendations = count(row.recommendations);
    const total = count(row.total);
    if (
      !handle ||
      prices === null ||
      reviews === null ||
      recommendations === null ||
      total === null ||
      total !== prices + reviews + recommendations
    ) {
      return rankContributors([], "degraded");
    }
    tallies.push({ handle, prices, reviews, recommendations, total });
  }
  return rankContributorTallies(tallies, "ready");
}

async function readDurableBoard(): Promise<ContributorLeaderboard> {
  try {
    const { data, error } = await requireSupabaseAdmin().rpc(
      "public_contributor_leaderboard",
    );
    if (error) throw new Error(error.message);
    return durableBoard(data);
  } catch {
    return rankContributors([], "degraded");
  }
}

export async function readContributorLeaderboard(): Promise<ContributorLeaderboard> {
  if (isSupabaseConfigured()) return readDurableBoard();
  return rankContributors([], "degraded");
}
