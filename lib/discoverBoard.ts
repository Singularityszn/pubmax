import { cheapestPints, type LeaderboardRowView } from "@/lib/leaderboard";
import { statedDrinkMeasure, type DrinkMeasure } from "@/lib/drinkMeasure";
import { firstHttps } from "@/lib/httpUrl";
import { PRICE_STANDINGS, type PriceStanding } from "@/lib/priceTier";
import type { Venue } from "@/lib/venues";

// The Discover board, cut from the bundled pint dataset at BUILD time.
//
// Discover prints ten rows and a handful of "Then vs Now" comparisons. It used
// to fetch `public/data/pint_prices_app_dataset.json` in the BROWSER to get
// them: 6,868 KB decoded and parsed on a phone, the largest single response the
// product serves anybody, for ten rows. Nothing in that download is a live
// number, every figure being a build artifact, so the answer is cut once by
// `npm run build:discover-board` and shipped as this file.
//
// TWO lanes, because they are two questions:
//   `cheapest`  is the finished leaderboard, ranked here so the producer and
//               the reader cannot disagree about what "cheapest" means.
//   `baselines` is the "then" half of Then vs Now, which cannot be precomputed
//               because the "now" half is a live community drop read at
//               request time. It carries the exact drink and source-row
//               identities; the board-level date and serving complete the
//               observation without repeating them 950 times.
//
// Pure: no fetch, no React, no filesystem. The script writes it, the page
// parses it, `__tests__/discoverBoard.test.ts` recomputes it from the dataset
// and fails when the shipped file drifts.

/** Where the built board is served from. */
export const DISCOVER_BOARD_PATH = "/data/discover/board.json";

/** How many rows the leaderboard publishes. */
export const DISCOVER_BOARD_LIMIT = 10;

const DISCOVER_BASELINE_SOURCE_ORIGIN = "https://www.pint-prices.com";

/**
 * One ranked row. It IS `LeaderboardRowView`, so the built file and the table
 * that prints it are one shape rather than two that can drift.
 */
export type DiscoverBoardRow = LeaderboardRowView;

/** One venue's dated baseline price identity. */
type DiscoverBoardBaseline = {
  id: string;
  name: string;
  cheapestPrice: number;
  drink: string;
  sourceId: string;
  /** Pint Prices path, or the full HTTPS URL for another named publisher. */
  sourceRef: string;
  priceCondition?: "regular" | "promotion";
  priceTerms?: string;
};

export type DiscoverBoard = {
  /**
   * The day the dataset's prices were COLLECTED, not the day this file was
   * written: a build artifact dressed up as a collection date is the one thing
   * `lib/dataFreshness.ts` exists to prevent. Deriving it also keeps the file
   * byte-stable across builds, so a rebuild is not a diff.
   */
  observedAt: string;
  baselineMeasure: DrinkMeasure | null;
  cheapest: DiscoverBoardRow[];
  baselines: DiscoverBoardBaseline[];
};

function compactBaselineSource(...candidates: Array<string | undefined>): string {
  const source = firstHttps(...candidates);
  if (!source) return "";
  const url = new URL(source);
  return url.origin === DISCOVER_BASELINE_SOURCE_ORIGIN
    ? `${url.pathname}${url.search}${url.hash}`
    : url.href;
}

/** Resolve a compact board reference into a safe, inspectable HTTPS source. */
export function discoverBaselineSourceUrl(sourceRef: string): string | null {
  const ref = sourceRef.trim();
  if (!ref) return null;
  try {
    if (ref.startsWith("/")) {
      const url = new URL(ref, DISCOVER_BASELINE_SOURCE_ORIGIN);
      return url.origin === DISCOVER_BASELINE_SOURCE_ORIGIN ? url.href : null;
    }
    const source = firstHttps(ref);
    return source ? new URL(source).href : null;
  } catch {
    return null;
  }
}

/**
 * Cut the board from the grouped dataset. The producer's whole rule, so the
 * build script holds no ranking logic of its own.
 */
export function discoverBoardFromVenues(
  venues: Venue[],
  observedAt: string,
  limit = DISCOVER_BOARD_LIMIT,
): DiscoverBoard {
  const cheapest = cheapestPints(venues, limit).map((entry) => ({
    rank: entry.rank,
    area: entry.area,
    standing: entry.standing,
    venue: {
      id: entry.venue.id,
      name: entry.venue.name,
      cheapestPint: entry.venue.cheapestPint,
      cheapestPrice: entry.venue.cheapestPrice,
    },
  }));

  const baselines: DiscoverBoardBaseline[] = [];
  for (const venue of venues) {
    const price = venue.cheapestPrice;
    if (typeof price !== "number" || !Number.isFinite(price)) continue;
    const source = venue.prices.find(
      (row) => row.price_gbp === price && row.pint_name === venue.cheapestPint,
    );
    baselines.push({
      id: venue.id,
      name: venue.name,
      cheapestPrice: price,
      drink: source?.pint_name ?? venue.cheapestPint,
      sourceId: source?.app_price_id ?? "",
      sourceRef: compactBaselineSource(source?.pub_url, source?.constructed_pub_url),
    });
  }

  return { observedAt, baselineMeasure: "pint", cheapest, baselines };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isPriceStanding(value: unknown): value is PriceStanding {
  return typeof value === "string" && (PRICE_STANDINGS as readonly string[]).includes(value);
}

function parseRow(raw: unknown): DiscoverBoardRow | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const venue = row.venue;
  if (!venue || typeof venue !== "object") return null;
  const v = venue as Record<string, unknown>;
  if (typeof v.id !== "string" || !v.id) return null;
  if (typeof v.name !== "string") return null;
  if (!isFiniteNumber(v.cheapestPrice)) return null;
  if (!isFiniteNumber(row.rank)) return null;
  // A row without a standing is DROPPED rather than defaulted: a default here
  // would print a trust word nobody decided, which is the unlabelled board this
  // field was added to end.
  if (!isPriceStanding(row.standing)) return null;
  return {
    rank: row.rank,
    area: typeof row.area === "string" ? row.area : "",
    standing: row.standing,
    venue: {
      id: v.id,
      name: v.name,
      cheapestPint: typeof v.cheapestPint === "string" ? v.cheapestPint : "",
      cheapestPrice: v.cheapestPrice,
    },
  };
}

function parseBaseline(raw: unknown): DiscoverBoardBaseline | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  if (typeof row.id !== "string" || !row.id) return null;
  if (typeof row.name !== "string") return null;
  if (!isFiniteNumber(row.cheapestPrice)) return null;
  return {
    id: row.id,
    name: row.name,
    cheapestPrice: row.cheapestPrice,
    drink: typeof row.drink === "string" ? row.drink : "",
    sourceId: typeof row.sourceId === "string" ? row.sourceId : "",
    sourceRef:
      typeof row.sourceRef === "string" && discoverBaselineSourceUrl(row.sourceRef)
        ? row.sourceRef
        : "",
    priceCondition:
      row.priceCondition === "regular" || row.priceCondition === "promotion"
        ? row.priceCondition
        : undefined,
    priceTerms:
      typeof row.priceTerms === "string" && row.priceTerms.trim()
        ? row.priceTerms
        : undefined,
  };
}

/**
 * Read a served board defensively. A malformed body answers null, so the page
 * shows its own empty note rather than crashing over a bad artifact; a row that
 * does not parse is dropped and the rest of the board still prints.
 */
export function parseDiscoverBoard(raw: unknown): DiscoverBoard | null {
  if (!raw || typeof raw !== "object") return null;
  const body = raw as Record<string, unknown>;
  if (!Array.isArray(body.cheapest) || !Array.isArray(body.baselines)) return null;
  const cheapest: DiscoverBoardRow[] = [];
  for (const item of body.cheapest) {
    const row = parseRow(item);
    if (row) cheapest.push(row);
  }
  const baselines: DiscoverBoardBaseline[] = [];
  for (const item of body.baselines) {
    const row = parseBaseline(item);
    if (row) baselines.push(row);
  }
  return {
    observedAt: typeof body.observedAt === "string" ? body.observedAt : "",
    baselineMeasure: statedDrinkMeasure(body.baselineMeasure),
    cheapest,
    baselines,
  };
}
