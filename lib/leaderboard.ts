import { measureIsPint, type DrinkMeasure } from "@/lib/drinkMeasure";
import { isoDate, PINT_DATASET_OBSERVED_AT } from "@/lib/dataFreshness";
import { DAY_MS } from "@/lib/dayMs";
import { answerEvidenceFor } from "@/lib/landingHero";
import type { PriceStanding } from "@/lib/priceTier";
import type { Venue } from "@/lib/venues";

// Pure ranking helpers over grouped Venue[] for the /discover leaderboard.
// No fetch, no React, no side effects — everything here is a plain transform so
// it can be unit-tested directly (see __tests__/leaderboard.test.ts).

// A venue that carries a usable (non-null) cheapest price. Narrowing to this
// shape lets callers treat `cheapestPrice` as a number without re-checking.
export type PricedVenue = Venue & { cheapestPrice: number };

// A venue paired with its rank + area, ready to hand straight to the table.
export type LeaderboardEntry = {
  rank: number;
  venue: PricedVenue;
  area: string;
  /**
   * How far the figure in this row may be trusted, DECIDED here so the table
   * stays a pure renderer and no surface re-decides what a price is worth.
   */
  standing: PriceStanding;
};

// Everything a leaderboard row PRINTS, and nothing else. `LeaderboardEntry`
// satisfies it, and so does a row cut at build time (lib/discoverBoard.ts), so
// the table cannot demand a whole grouped Venue, and a 6.87 MB dataset to build
// one, for the four fields it renders.
export type LeaderboardRowView = {
  rank: number;
  area: string;
  /**
   * The trust label the row wears. Carried on the VIEW as well as the entry,
   * because a build-time cut (lib/discoverBoard.ts) prints the same row and a
   * figure without its standing is the unlabelled board the captain refused.
   */
  standing: PriceStanding;
  venue: Pick<Venue, "id" | "name" | "cheapestPint"> & { cheapestPrice: number };
};

// The fallback area label used when a venue has no borough/area field at all.
export const UNKNOWN_AREA = "Greater London";

// We group by `primaryBorough` because it is the app's canonical area field:
// the dataset fills it for all but a handful of rows (29 distinct London
// boroughs), and it already drives the map's borough context. When a venue has
// no primaryBorough we fall back to the first visibleBorough, then to a coarse
// UNKNOWN_AREA bucket — so a sparse row is grouped, never dropped.
export function venueArea(venue: Venue): string {
  const primary = venue.primaryBorough?.trim();
  if (primary) return primary;
  const visible = venue.visibleBoroughs.find((borough) => borough.trim());
  if (visible) return visible.trim();
  return UNKNOWN_AREA;
}

function hasPrice(venue: Venue): venue is PricedVenue {
  return typeof venue.cheapestPrice === "number";
}

/**
 * EVERY ROW WEARS ITS TRUST LABEL, AND A ROW THAT CANNOT EARN ONE IS NOT ON
 * THIS BOARD. Captain 6 Sep 2026, ruling on the board's own honesty: it keeps
 * its ten listed rows and each says out loud that a listing is all it is.
 *
 * The reading is `answerEvidenceFor`, the SAME one the landing answer card
 * makes, so the word beside a price here and the word beside the same price on
 * the landing cannot differ: the venue's own rows name the publisher, the
 * bundled dataset's collection day dates it, and `lib/priceTier.ts` decides.
 * There is no second opinion about a price.
 */
export function leaderboardStandingFor(
  venue: PricedVenue,
  now: number = Date.now(),
): PriceStanding {
  return answerEvidenceFor(
    {
      priceGbp: venue.cheapestPrice,
      prices: venue.prices ?? [],
      collectedOn: isoDate(PINT_DATASET_OBSERVED_AT),
    },
    now,
  ).standing;
}

/**
 * A board of LISTED prices may only hold a row that earned a listing. The
 * alternative is a row printing "No price yet" beside a figure it is showing,
 * which is the contradiction a label was added to prevent.
 */
export function leaderboardAdmitsStanding(standing: PriceStanding): boolean {
  return standing === "listed" || standing === "confirmed";
}

// ── The Cheap Pint Leaderboard reads as a fact about pubs ───────────────────
// Captain 6 Sep 2026, over the /social?tab=discover board: it listed seven pubs
// at £1.99 and five of them were the same drink. Measured on the shipped
// dataset, all ten ranked rows were one chain, six sat at £1.99, and rows 7 and
// 9 were the SAME pub twice ("J.J. Moons" and "J.J. Moon's - JD Wetherspoon",
// both in Wandsworth). A reader met ten rows and learned one thing: what one
// company charges for Bud Light. The board is meant to say ten things about
// London.
//
// Two rules, both about what a row is EVIDENCE of, and neither invents a price.

/**
 * The operator suffix the dataset appends to some rows of a chain. It is
 * spelling, not identity: the same pub is filed twice, once with it and once
 * without. Grow this table only when a dataset row proves another spelling.
 */
const OPERATOR_NAME_SUFFIX = /\s*[-(]\s*(?:jd\s*)?wetherspoons?\b[^)]*\)?\s*$/;

function normaliseVenueName(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(OPERATOR_NAME_SUFFIX, " ")
      // An apostrophe is dropped rather than folded to a space, or "J.J. Moons"
      // and "J.J. Moon\u2019s" read as two pubs, which is how one Wandsworth pub
      // held two of the board's ten rows.
      .replace(/['\u2018\u2019\u02bc]/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
  );
}

/**
 * ONE ROW PER PUB. A pub is one pub however many ways the dataset spells it, so
 * identity is the normalised name inside its own area. Two pubs of one name in
 * one area collapse to one row, which is the safe side: a leaderboard that
 * shows a pub twice is wrong in a way a reader can see.
 */
export function leaderboardPubKey(venue: Venue): string {
  return `${normaliseVenueName(venue.name)}@${venueArea(venue).toLowerCase()}`;
}

/**
 * NEVER A CHAIN LIST PRICE. A figure several pubs publish to the penny for the
 * same drink is a price LIST, not a fact about any one of them, so it earns one
 * row and no more. The drink must be NAMED: a bare figure proves no list, and a
 * row with no drink beside it is left to rank on its own.
 */
function sharedPriceListKey(venue: PricedVenue): string | null {
  const drink = venue.cheapestPint.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (!drink) return null;
  return `${venue.cheapestPrice.toFixed(2)}|${drink}`;
}

// Cheapest priced venues, ascending. Venues with a null cheapestPrice are
// dropped entirely (they can't be ranked on price). Ties break on name so the
// order is deterministic across renders, which is also what decides WHICH pub
// keeps a shared price list's one row. `limit` caps the returned list, and it
// is a WINDOW over what survived both rules, never a filter applied after it.
export function cheapestPints(
  venues: Venue[],
  limit = 10,
  now: number = Date.now(),
): LeaderboardEntry[] {
  const seenPub = new Set<string>();
  const seenPriceList = new Set<string>();
  const ranked: Array<{ venue: PricedVenue; standing: PriceStanding }> = [];

  for (const venue of venues
    .filter(hasPrice)
    .sort(
      (a, b) =>
        a.cheapestPrice - b.cheapestPrice || a.name.localeCompare(b.name),
    )) {
    if (ranked.length >= Math.max(0, limit)) break;

    const pub = leaderboardPubKey(venue);
    if (seenPub.has(pub)) continue;

    const priceList = sharedPriceListKey(venue);
    if (priceList !== null && seenPriceList.has(priceList)) continue;

    // Asked LAST of the three, so a row refused for its standing has already
    // been refused, or admitted, on identity. A pub kept out here has not
    // spent its own pub key, so nothing else of its is held out with it.
    const standing = leaderboardStandingFor(venue, now);
    if (!leaderboardAdmitsStanding(standing)) continue;

    seenPub.add(pub);
    if (priceList !== null) seenPriceList.add(priceList);
    ranked.push({ venue, standing });
  }

  return ranked.map((entry, index) => ({
    rank: index + 1,
    venue: entry.venue,
    area: venueArea(entry.venue),
    standing: entry.standing,
  }));
}

// The single cheapest priced venue in each area. Venues with no price are
// ignored; areas with no priced venue don't appear. The result is sorted by
// price ascending so the cheapest areas lead. Ties break on area name.
export function cheapestByArea(venues: Venue[]): LeaderboardEntry[] {
  const cheapestPerArea = new Map<string, PricedVenue>();

  for (const venue of venues) {
    if (!hasPrice(venue)) continue;
    const area = venueArea(venue);
    const current = cheapestPerArea.get(area);
    if (
      !current ||
      venue.cheapestPrice < current.cheapestPrice ||
      (venue.cheapestPrice === current.cheapestPrice &&
        venue.name.localeCompare(current.name) < 0)
    ) {
      cheapestPerArea.set(area, venue);
    }
  }

  return Array.from(cheapestPerArea.entries())
    .map(([area, venue]) => ({
      area,
      venue,
      rank: 0,
      standing: leaderboardStandingFor(venue),
    }))
    .sort(
      (a, b) =>
        a.venue.cheapestPrice - b.venue.cheapestPrice ||
        a.area.localeCompare(b.area),
    )
    .map((entry, index) => ({ ...entry, rank: index + 1 }));
}

// ── "Cheapest pints logged tonight" (PRD §5.1) ──────────────────────────────
// A live, community-driven leaderboard: the cheapest community Pint Drops
// reported in the trailing 24h. Unlike cheapestPints (which ranks the dataset
// baseline), this ranks what people actually paid *tonight* — the reason to
// reopen Discover on a Friday. Pure/testable: no fetch, no React, `now`
// injectable so "the last 24h" is deterministic under test.

// The minimal community-drop shape cheapestTonight reads. The public
// /api/pint-drops DTO satisfies this (venueId, priceGbp, createdAt, handle,
// server-enriched venueName); callers narrow the API payload before passing it.
export type TonightDrop = {
  id?: string;
  measure?: DrinkMeasure;
  measureLabel?: string;
  drink?: string;
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
    if (!drop.venueId || !measureIsPint(drop.measure)) continue;
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
