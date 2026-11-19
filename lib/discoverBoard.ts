import type { HuntStanding } from "@/lib/cheapestHunt";
import { isHttpUrl } from "@/lib/httpUrl.mjs";
import type { TonightCheapPint } from "@/lib/tonightCheapPints";
import type { Venue } from "@/lib/venues";
import { displayVenueName } from "@/lib/venueDisplay";

// The build ships the shared London ranking and compact historical baselines
// together so the browser never downloads the full pint dataset.

/** Where the built board is served from. */
export const DISCOVER_BOARD_PATH = "/data/discover/rankings.json";

/** How many rows the leaderboard publishes. */
export const DISCOVER_BOARD_LIMIT = 10;

export type DiscoverBoardRow = {
  rank: number;
  area: string;
  mapHref: string;
  publisher: { label: string; url: string };
  observedAt: string;
  standing: HuntStanding;
  venue: Pick<Venue, "id" | "name" | "cheapestPint"> & { cheapestPrice: number };
};

/** One venue's "then" price: the three fields `computeThenVsNow` reads. */
type DiscoverBoardBaseline = {
  id: string;
  name: string;
  cheapestPrice: number;
};

export type DiscoverBoard = {
  /**
   * The day the dataset's prices were COLLECTED, not the day this file was
   * written: a build artifact dressed up as a collection date is the one thing
   * `lib/dataFreshness.ts` exists to prevent. Deriving it also keeps the file
   * byte-stable across builds, so a rebuild is not a diff.
   */
  observedAt: string;
  cheapest: DiscoverBoardRow[];
  baselines: DiscoverBoardBaseline[];
};

export function discoverBoardFromVenues(
  venues: Venue[],
  observedAt: string,
  ranking: readonly TonightCheapPint[],
): DiscoverBoard {
  const cheapest: DiscoverBoardRow[] = [];
  for (const entry of ranking) {
    if (!entry.publisher || !entry.observedAt || !entry.standing || !entry.mapHref) continue;
    cheapest.push({
      rank: cheapest.length + 1,
      area: entry.borough,
      publisher: entry.publisher,
      observedAt: entry.observedAt,
      standing: entry.standing,
      mapHref: entry.mapHref,
      venue: {
        id: entry.venueId,
        name: entry.name,
        cheapestPint: entry.drinkLabel ?? "",
        cheapestPrice: entry.priceGbp,
      },
    });
  }

  const baselines: DiscoverBoardBaseline[] = [];
  for (const venue of venues) {
    const price = venue.cheapestPrice;
    if (typeof price !== "number" || !Number.isFinite(price)) continue;
    baselines.push({ id: venue.id, name: venue.name, cheapestPrice: price });
  }

  return { observedAt, cheapest, baselines };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function parsePublisher(raw: unknown): DiscoverBoardRow["publisher"] | null {
  if (!raw || typeof raw !== "object") return null;
  const { label, url } = raw as Record<string, unknown>;
  return typeof label === "string" && label.trim() && isHttpUrl(url) ? { label, url } : null;
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
  if (row.standing !== "listed" && row.standing !== "confirmed") return null;
  if (typeof row.area !== "string" || !row.area.trim()) return null;
  if (typeof row.mapHref !== "string" || !row.mapHref.startsWith("/map?sel=")) return null;
  if (typeof row.observedAt !== "string" || !Number.isFinite(Date.parse(row.observedAt))) return null;
  const publisher = parsePublisher(row.publisher);
  if (!publisher) return null;
  return {
    rank: row.rank,
    area: row.area,
    mapHref: row.mapHref,
    publisher,
    observedAt: row.observedAt,
    standing: row.standing,
    venue: {
      id: v.id,
      name: displayVenueName(v.name),
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
  return { id: row.id, name: displayVenueName(row.name), cheapestPrice: row.cheapestPrice };
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
    cheapest,
    baselines,
  };
}
