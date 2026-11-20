import { DAY_MS } from "@/lib/dayMs";

// ── "Cheapest pints logged tonight" (PRD §5.1) ──────────────────────────────
// A live, community-driven leaderboard: the cheapest community Pint Drops
// reported in the trailing 24h. The clock is injectable so the window is
// deterministic under test.

// The minimal community-drop shape cheapestTonight reads. The public
// /api/pint-drops DTO satisfies this (venueId, priceGbp, createdAt, handle,
// server-enriched venueName); callers narrow the API payload before passing it.
export type TonightDrop = {
  venueId: string;
  priceGbp: number | null;
  createdAt: string;
  handle?: string;
  venueName?: string;
  avatarUrl?: string;
};

// One ranked row of the tonight board, ready to hand straight to the board.
export type TonightEntry = {
  rank: number;
  venueId: string;
  venueName: string;
  priceGbp: number;
  handle?: string;
  createdAt: string;
  avatarUrl?: string;
};

// The friendly label used when a drop carries no resolvable pub name — kept in
// step with the API's VENUE_FALLBACK_LABEL so the board never shows a raw id.
const TONIGHT_FALLBACK_VENUE = "A London pub";

function isFinitePrice(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

// Parse an ISO createdAt to epoch ms; NaN for an unparseable/empty string so
// such drops fall out of the 24h window rather than crashing the compare.
function dropTime(createdAt: string): number {
  return Date.parse(createdAt);
}

export type CheapestTonightOptions = {
  // Upper bound of the window (defaults to Date.now()). Injectable for tests.
  now?: number;
  // Max rows returned (defaults to 10).
  limit?: number;
};

// Rank the cheapest community Pint Drops from the trailing 24h, cheapest-first,
// one row per venue (the cheapest drop for that venue wins). A drop qualifies
// only when it carries a finite priceGbp AND a createdAt inside (now - 24h, now].
// Ties are fully deterministic: price, then createdAt (older first), then
// venueId. Empty/malformed input → []. `now` is injectable for testability.
export function cheapestTonight(
  drops: TonightDrop[],
  opts: CheapestTonightOptions = {},
): TonightEntry[] {
  const now = opts.now ?? Date.now();
  const limit = opts.limit ?? 10;
  const windowStart = now - DAY_MS;

  // Keep the single cheapest qualifying drop per venue. On a tie between two
  // drops for the same venue, prefer the earlier one, then the lower venueId —
  // so the winner is stable regardless of input order.
  const cheapestPerVenue = new Map<string, TonightEntry>();
  for (const drop of drops) {
    if (!drop.venueId) continue;
    if (!isFinitePrice(drop.priceGbp)) continue;
    const at = dropTime(drop.createdAt);
    if (!Number.isFinite(at) || at <= windowStart || at > now) continue;

    const candidate: TonightEntry = {
      rank: 0,
      venueId: drop.venueId,
      venueName: drop.venueName?.trim() || TONIGHT_FALLBACK_VENUE,
      priceGbp: drop.priceGbp,
      handle: drop.handle?.trim() || undefined,
      createdAt: drop.createdAt,
      avatarUrl: drop.avatarUrl,
    };

    const current = cheapestPerVenue.get(drop.venueId);
    if (!current || tonightBeats(candidate, current)) {
      cheapestPerVenue.set(drop.venueId, candidate);
    }
  }

  return Array.from(cheapestPerVenue.values())
    .sort(tonightCompare)
    .slice(0, Math.max(0, limit))
    .map((entry, index) => ({ ...entry, rank: index + 1 }));
}

// True when `a` should outrank `b`: cheaper wins; on a price tie the earlier
// drop wins; on a createdAt tie the lower venueId wins. Total + deterministic.
function tonightBeats(a: TonightEntry, b: TonightEntry): boolean {
  return tonightCompare(a, b) < 0;
}

function tonightCompare(a: TonightEntry, b: TonightEntry): number {
  return (
    a.priceGbp - b.priceGbp ||
    a.createdAt.localeCompare(b.createdAt) ||
    a.venueId.localeCompare(b.venueId)
  );
}
