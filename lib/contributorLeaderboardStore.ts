// Server-only read seam for the public contributor record. Source stores own
// contribution truth; this module only combines their private projections and
// returns the small public aggregate.

import {
  rankContributors,
  rankContributorTallies,
  type ContributorLeaderboard,
  type ContributorLeaderboardTally,
} from "@/lib/contributorLeaderboard";
import { communityPriceStore } from "@/lib/communityPriceStore";
import { normalizeHandle } from "@/lib/profiles";
import {
  isSupabaseConfigured,
  requireSupabaseAdmin,
} from "@/lib/supabase";
import { visitReportsStore } from "@/lib/visitReportsStore";
import { weatherRecommendationStore } from "@/lib/weatherRecommendationStore";

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

  const reads = await Promise.allSettled([
    communityPriceStore().listLeaderboardContributions(),
    visitReportsStore().listLeaderboardContributions(),
    weatherRecommendationStore().listLeaderboardContributions(),
  ]);
  if (
    reads.some(
      (read) =>
        read.status === "rejected" || read.value.status !== "ready",
    )
  ) {
    return rankContributors([], "degraded");
  }
  return rankContributors(
    reads.flatMap((read) =>
      read.status === "fulfilled" ? read.value.records : [],
    ),
    "ready",
  );
}
