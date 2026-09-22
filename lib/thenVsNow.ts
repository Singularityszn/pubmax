import type { Provenance } from "@/lib/curation";
import { PINT_DATASET_OBSERVED_AT } from "@/lib/dataFreshness";
import {
  drinkMeasureName,
  statedDrinkMeasure,
  type DrinkMeasure,
} from "@/lib/drinkMeasure";
import { firstHttps } from "@/lib/httpUrl";
import type { Venue } from "@/lib/venues";

// "Then vs Now" — connect a venue's baseline dataset price ("then") to the most
// recent community-reported Pint Drop price ("now"). Pure/testable: no fetch, no
// React, no side effects. The /discover page feeds it grouped Venue[] plus the
// public drops from GET /api/pint-drops and renders the result.

// The minimal community-drop shape computeThenVsNow reads. The public
// /api/pint-drops DTO satisfies this (it carries venueId, priceGbp, createdAt);
// callers narrow the API payload to this before passing it in.
export type ThenVsNowDrop = {
  id?: string;
  drink?: string;
  measure?: DrinkMeasure;
  measureLabel?: string;
  priceCondition?: ThenVsNowPriceCondition;
  priceTerms?: string;
  handle?: string;
  venueId: string;
  priceGbp: number | null;
  createdAt: string;
};

// The "then" half: the three fields this reads off a venue and nothing else. A
// grouped `Venue` satisfies it, and so does a baseline row cut at build time
// (lib/discoverBoard.ts), so asking for a comparison never means downloading
// the whole priced dataset to a browser.
export type ThenVsNowVenue = {
  drink?: string;
  cheapestPint?: string;
  measure?: DrinkMeasure;
  measureLabel?: string;
  observedAt?: string;
  priceCondition?: ThenVsNowPriceCondition;
  priceTerms?: string;
  sourceId?: string;
  sourceUrl?: string;
  id: string;
  name: string;
  cheapestPrice: number | null;
};

export type ThenVsNowPriceCondition = "regular" | "promotion";

function isPriceCondition(value: unknown): value is ThenVsNowPriceCondition {
  return value === "regular" || value === "promotion";
}

export type ThenVsNowComparison =
  | "comparable"
  | "drink-mismatch"
  | "serving-mismatch"
  | "date-mismatch"
  | "terms-mismatch";

// One resolved comparison row, ready to hand straight to a card.
// - thenGbp  = the venue's baseline/dataset cheapest price
// - nowGbp   = the price on the most-recent priced community drop for that venue
// - deltaGbp = nowGbp - thenGbp only for an exact, ordered observation pair
// - pct      = deltaGbp / thenGbp * 100; null when comparison is unsupported
export type ThenVsNowItem = {
  venueId: string;
  venueName: string;
  thenGbp: number;
  nowGbp: number;
  deltaGbp: number | null;
  pct: number | null;
  comparison: ThenVsNowComparison;
  thenDrink: string;
  nowDrink: string;
  thenMeasure: DrinkMeasure | null;
  nowMeasure: DrinkMeasure | null;
  thenMeasureLabel: string;
  nowMeasureLabel: string;
  thenObservedAt: string | null;
  nowObservedAt: string | null;
  thenPriceCondition: ThenVsNowPriceCondition | null;
  nowPriceCondition: ThenVsNowPriceCondition | null;
  thenPriceTerms: string;
  nowPriceTerms: string;
  thenSourceId: string | null;
  thenSourceUrl: string | null;
  nowSourceId: string | null;
  nowHandle: string | null;
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function cleanIdentity(value: string | null | undefined): string {
  return (value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
}

function sameIdentity(left: string, right: string): boolean {
  return left.localeCompare(right, "en-GB", { sensitivity: "base" }) === 0;
}

function observationTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function observationDay(value: number): string {
  return new Date(value).toISOString().slice(0, 10);
}

function comparisonFor(
  venue: ThenVsNowVenue,
  drop: ThenVsNowDrop,
): ThenVsNowComparison {
  const thenDrink = cleanIdentity(venue.drink ?? venue.cheapestPint);
  const nowDrink = cleanIdentity(drop.drink);
  if (!thenDrink || !nowDrink || !sameIdentity(thenDrink, nowDrink)) {
    return "drink-mismatch";
  }

  const thenMeasure = statedDrinkMeasure(venue.measure);
  const nowMeasure = statedDrinkMeasure(drop.measure);
  if (!thenMeasure || !nowMeasure || thenMeasure !== nowMeasure) {
    return "serving-mismatch";
  }
  if (thenMeasure === "other") {
    const thenLabel = cleanIdentity(venue.measureLabel);
    const nowLabel = cleanIdentity(drop.measureLabel);
    if (!thenLabel || !nowLabel || !sameIdentity(thenLabel, nowLabel)) {
      return "serving-mismatch";
    }
  }

  const thenAt = observationTime(venue.observedAt);
  const nowAt = observationTime(drop.createdAt);
  if (
    thenAt === null ||
    nowAt === null ||
    thenAt >= nowAt ||
    observationDay(thenAt) === observationDay(nowAt)
  ) {
    return "date-mismatch";
  }

  if (
    !isPriceCondition(venue.priceCondition) ||
    !isPriceCondition(drop.priceCondition) ||
    venue.priceCondition !== drop.priceCondition
  ) {
    return "terms-mismatch";
  }
  if (venue.priceCondition === "promotion") {
    const thenTerms = cleanIdentity(venue.priceTerms);
    const nowTerms = cleanIdentity(drop.priceTerms);
    if (!thenTerms || !nowTerms || !sameIdentity(thenTerms, nowTerms)) {
      return "terms-mismatch";
    }
  }

  return "comparable";
}

// The most-recent priced drop for a venue: filter to drops carrying a usable
// price, then pick the newest valid timestamp. An undated observation remains
// displayable only when there is no dated candidate and can never be compared.
// Returns null when the venue has no priced community drop at all.
function mostRecentPricedDrop(drops: ThenVsNowDrop[]): ThenVsNowDrop | null {
  let best: ThenVsNowDrop | null = null;
  let bestAt: number | null = null;
  for (const drop of drops) {
    if (!isFiniteNumber(drop.priceGbp)) continue;
    const at = observationTime(drop.createdAt);
    if (!best || (at !== null && (bestAt === null || at > bestAt))) {
      best = drop;
      bestAt = at;
    }
  }
  return best;
}

// Build the "Then vs Now" rows. A venue only qualifies when it carries BOTH
// signals: a baseline `cheapestPrice` ("then") AND at least one priced community
// drop ("now"). Venues missing either are silently ignored.
//
// Ranking: exact comparisons lead by absolute movement. Independent
// observations never receive a trend rank and fall back to venue name.
export function computeThenVsNow(
  venues: readonly ThenVsNowVenue[],
  drops: ThenVsNowDrop[],
  limit = 8,
): ThenVsNowItem[] {
  // Bucket drops by venue once so each venue is a single Map read.
  const byVenue = new Map<string, ThenVsNowDrop[]>();
  for (const drop of drops) {
    const key = drop.venueId;
    if (!key) continue;
    byVenue.set(key, [...(byVenue.get(key) ?? []), drop]);
  }

  const items: ThenVsNowItem[] = [];
  for (const venue of venues) {
    const thenGbp = venue.cheapestPrice;
    if (!isFiniteNumber(thenGbp)) continue; // no "then" baseline → skip

    const now = mostRecentPricedDrop(byVenue.get(venue.id) ?? []);
    if (!now || !isFiniteNumber(now.priceGbp)) continue; // no "now" community price → skip

    const nowGbp = now.priceGbp;
    const comparison = comparisonFor(venue, now);
    const deltaGbp = comparison === "comparable" ? nowGbp - thenGbp : null;
    const pct =
      deltaGbp === null ? null : thenGbp !== 0 ? (deltaGbp / thenGbp) * 100 : 0;

    items.push({
      venueId: venue.id,
      venueName: venue.name,
      thenGbp,
      nowGbp,
      deltaGbp,
      pct,
      comparison,
      thenDrink: cleanIdentity(venue.drink ?? venue.cheapestPint),
      nowDrink: cleanIdentity(now.drink),
      thenMeasure: statedDrinkMeasure(venue.measure),
      nowMeasure: statedDrinkMeasure(now.measure),
      thenMeasureLabel: cleanIdentity(venue.measureLabel),
      nowMeasureLabel: cleanIdentity(now.measureLabel),
      thenObservedAt: observationTime(venue.observedAt) === null ? null : venue.observedAt ?? null,
      nowObservedAt: observationTime(now.createdAt) === null ? null : now.createdAt,
      thenPriceCondition: isPriceCondition(venue.priceCondition)
        ? venue.priceCondition
        : null,
      nowPriceCondition: isPriceCondition(now.priceCondition)
        ? now.priceCondition
        : null,
      thenPriceTerms: cleanIdentity(venue.priceTerms),
      nowPriceTerms: cleanIdentity(now.priceTerms),
      thenSourceId: cleanIdentity(venue.sourceId) || null,
      thenSourceUrl: firstHttps(venue.sourceUrl) || null,
      nowSourceId: cleanIdentity(now.id) || null,
      nowHandle: cleanIdentity(now.handle) || null,
    });
  }

  return items
    .sort(
      (a, b) => {
        if (a.deltaGbp !== null && b.deltaGbp === null) return -1;
        if (a.deltaGbp === null && b.deltaGbp !== null) return 1;
        if (a.deltaGbp !== null && b.deltaGbp !== null) {
          const movement = Math.abs(b.deltaGbp) - Math.abs(a.deltaGbp);
          if (movement !== 0) return movement;
        }
        return a.venueName.localeCompare(b.venueName);
      },
    )
    .slice(0, Math.max(0, limit));
}

// ────────────────────────────────────────────────────────────────────────────
// The Golden Thread — per-venue price story with inflation ("a pint here was £X
// in YYYY — £Y in today's money"). Everything below is pure/testable: no fetch,
// no React, no side effects. The venue surface (VenueInspector) feeds it the
// selected Venue plus that venue's drops and renders the resolved story.
// ────────────────────────────────────────────────────────────────────────────

// UK CPI (all items, 2015 = 100) decadal anchors, annual averages. Post-1988
// values are ONS series D7BT; pre-1988 use the ONS long-run modelled CPI
// back-series, rounded to the tenth. These are the only "inflation" numbers in
// the app, kept as a compact anchor table so the math stays deterministic and
// unit-testable offline (no live index fetch). We linearly interpolate BETWEEN
// anchors and clamp OUTSIDE the covered range, so a stray year never throws.
const CPI_ANCHORS: ReadonlyArray<readonly [year: number, index: number]> = [
  [1950, 6.6],
  [1960, 8.1],
  [1970, 11.0],
  [1980, 33.4],
  [1990, 58.2],
  [2000, 74.8],
  [2010, 92.6],
  [2015, 100.0],
  [2020, 108.9],
  [2024, 133.4],
];

// The "today" the CPI table revalues into — the newest anchor year. Kept as a
// named constant so both the math and the copy ("in today's money") agree on
// which year "today" means without a wall-clock dependency (deterministic).
export const INFLATION_TODAY_YEAR = CPI_ANCHORS[CPI_ANCHORS.length - 1][0];

// The CPI index for a year, linearly interpolated between the nearest anchors
// and clamped to the endpoint index outside the covered range. Returns null
// only for a non-finite year.
export function cpiIndexForYear(year: number): number | null {
  if (!isFiniteNumber(year)) return null;
  const first = CPI_ANCHORS[0];
  const last = CPI_ANCHORS[CPI_ANCHORS.length - 1];
  if (year <= first[0]) return first[1];
  if (year >= last[0]) return last[1];
  for (let i = 1; i < CPI_ANCHORS.length; i += 1) {
    const [loYear, loIdx] = CPI_ANCHORS[i - 1];
    const [hiYear, hiIdx] = CPI_ANCHORS[i];
    if (year <= hiYear) {
      const t = (year - loYear) / (hiYear - loYear);
      return loIdx + t * (hiIdx - loIdx);
    }
  }
  return last[1]; // unreachable given the clamp above, but keeps TS total
}

// Revalue a GBP amount from `fromYear` into INFLATION_TODAY_YEAR money using the
// CPI anchor table. Returns null when either the amount or the year can't be
// used (so the caller shows the honest "no historical anchor" state instead of
// a bogus figure). Rounds to the penny.
export function inflateToToday(amountGbp: number, fromYear: number): number | null {
  if (!isFiniteNumber(amountGbp)) return null;
  const fromIdx = cpiIndexForYear(fromYear);
  const todayIdx = cpiIndexForYear(INFLATION_TODAY_YEAR);
  if (fromIdx === null || todayIdx === null || fromIdx === 0) return null;
  return Math.round(amountGbp * (todayIdx / fromIdx) * 100) / 100;
}

// Pull a usable baseline YEAR out of a free-text era string. Community era tags
// look like "Dad's rule, 1980s", "The wedding, 1971", "Nan's shift, 1950s".
// A bare 4-digit year wins; a "…0s" decade resolves to its MIDPOINT (1980s →
// 1985) so the inflation anchor sits in the middle of the remembered span
// rather than its very start. Only years in a plausible pub-era range
// (1900–INFLATION_TODAY_YEAR) count — an address number or "£5" never leaks in.
export function parseEraYear(era: string | null | undefined): number | null {
  if (typeof era !== "string") return null;
  // Decade first ("1980s") so "1980" inside it doesn't win as a bare year.
  const decade = era.match(/\b(19|20)(\d)0s\b/);
  if (decade) {
    const base = Number(`${decade[1]}${decade[2]}0`);
    const mid = base + 5;
    if (mid >= 1900 && mid <= INFLATION_TODAY_YEAR) return mid;
  }
  const bare = era.match(/\b(19|20)\d{2}\b/);
  if (bare) {
    const year = Number(bare[0]);
    if (year >= 1900 && year <= INFLATION_TODAY_YEAR) return year;
  }
  return null;
}

// One resolved figure in a venue's price story. `provenance` is carried through
// verbatim so the surface can badge each row (sourced / contributor / anecdote
// / demo) and never flatten a demo price into "real" community data.
export type VenuePriceStamp = {
  gbp: number;
  provenance: Provenance;
  // A human label for the moment this price is FROM: an era string for a
  // historical drop, "Baseline on record" for the dataset price, "Community
  // tonight" for the newest priced drop.
  label: string;
};

// The historical "then" anchor: an anecdotal/contributor drop carrying BOTH a
// price and a parseable era year, revalued into today's money.
type VenueInflationAnchor = {
  year: number;
  thenGbp: number; // the price as originally remembered/logged
  todayGbp: number; // that same price in INFLATION_TODAY_YEAR money
  todayYear: number;
  provenance: Provenance;
  handle: string;
};

export type VenuePriceStory = {
  venueId: string;
  venueName: string;
  // The dataset baseline "price on record" (sourced/editorial), when present.
  baseline: VenuePriceStamp | null;
  // The freshest priced community drop ("now"), when present.
  now: VenuePriceStamp | null;
  // now.gbp - baseline.gbp only when computeThenVsNow can establish an exact
  // observation pair. Presence of two prices alone never creates a trend.
  deltaGbp: number | null;
  pct: number | null;
  // The inflation line: the best historical priced+dated drop revalued to today.
  // null when the venue has no drop that carries both a price and an era year.
  inflation: VenueInflationAnchor | null;
  // True when there is nothing to show at all — the surface renders its honest
  // empty state ("no price story on record yet").
  isEmpty: boolean;
};

// A drop shape rich enough to build the inflation anchor: the ThenVsNowDrop
// fields plus the era/handle/provenance the story needs. VenueInspector already
// holds full PintDrops for the venue, so it satisfies this directly.
export type VenuePriceStoryDrop = ThenVsNowDrop & {
  era?: string | null;
  handle?: string | null;
  provenance: Provenance;
};

// Pick the best historical inflation anchor: among drops that carry BOTH a
// finite price AND a parseable era year, prefer the OLDEST year (the deepest
// look back tells the most striking inflation story); ties break on the lower
// price, then newest createdAt, for determinism. Demo drops are eligible but
// keep their "demo" provenance so the surface badges them honestly.
function bestInflationAnchor(drops: VenuePriceStoryDrop[]): VenueInflationAnchor | null {
  let best: { year: number; drop: VenuePriceStoryDrop } | null = null;
  for (const drop of drops) {
    if (!isFiniteNumber(drop.priceGbp)) continue;
    const year = parseEraYear(drop.era);
    if (year === null) continue;
    if (
      !best ||
      year < best.year ||
      (year === best.year && drop.priceGbp < (best.drop.priceGbp ?? Infinity)) ||
      (year === best.year &&
        drop.priceGbp === best.drop.priceGbp &&
        drop.createdAt.localeCompare(best.drop.createdAt) > 0)
    ) {
      best = { year, drop };
    }
  }
  if (!best) return null;
  const todayGbp = inflateToToday(best.drop.priceGbp as number, best.year);
  if (todayGbp === null) return null;
  return {
    year: best.year,
    thenGbp: best.drop.priceGbp as number,
    todayGbp,
    todayYear: INFLATION_TODAY_YEAR,
    provenance: best.drop.provenance,
    handle: (best.drop.handle ?? "").trim() || "A drinker",
  };
}

// Build the whole per-venue price story in one pass. Pure: hand it the selected
// venue and that venue's drops. Each of the three surfaces (baseline / now /
// inflation) is resolved independently, so a venue can show any subset — and
// when it has none, `isEmpty` is true for an honest empty state. Provenance is
// NEVER flattened: the dataset baseline is "sourced", `now` and the inflation
// anchor carry their drop's own provenance.
export function computeVenuePriceStory(
  venue: Venue,
  drops: VenuePriceStoryDrop[],
): VenuePriceStory {
  const baselineGbp = venue.cheapestPrice;
  const baselineDate = PINT_DATASET_OBSERVED_AT.toISOString();
  const baselineSourceId =
    venue.prices?.find(
      (price) =>
        price.price_gbp === baselineGbp && price.pint_name === venue.cheapestPint,
    )?.app_price_id ?? null;
  const baseline: VenuePriceStamp | null = isFiniteNumber(baselineGbp)
    ? {
        gbp: baselineGbp,
        // The dataset baseline is editorial/sourced record, unless the venue's
        // curation explicitly marks its provenance otherwise (e.g. demo).
        provenance: venue.curation.provenance ?? "sourced",
        label: `${venue.cheapestPint || "Drink not recorded"} · Pint · ${baselineDate.slice(0, 10)}${baselineSourceId ? ` · ${baselineSourceId}` : " · source not recorded"}`,
      }
    : null;

  const nowDrop = mostRecentPricedDrop(drops);
  const now: VenuePriceStamp | null =
    nowDrop && isFiniteNumber(nowDrop.priceGbp)
      ? {
          gbp: nowDrop.priceGbp,
          provenance: (nowDrop as VenuePriceStoryDrop).provenance,
          label: `${cleanIdentity(nowDrop.drink) || "Drink not recorded"} · ${nowDrop.measure ? drinkMeasureName(nowDrop.measure, nowDrop.measureLabel) : "Serving not recorded"} · ${observationTime(nowDrop.createdAt) === null ? "Date not recorded" : nowDrop.createdAt.slice(0, 10)}${nowDrop.id ? ` · Pint Drop ${nowDrop.id}` : " · source not recorded"}`,
        }
      : null;

  let deltaGbp: number | null = null;
  let pct: number | null = null;
  if (baseline && now) {
    const comparison = computeThenVsNow(
      [
        {
          id: venue.id,
          name: venue.name,
          cheapestPrice: baseline.gbp,
          cheapestPint: venue.cheapestPint,
          measure: "pint",
          observedAt: baselineDate,
          sourceId: baselineSourceId ?? undefined,
        },
      ],
      drops,
      1,
    )[0];
    deltaGbp = comparison?.deltaGbp ?? null;
    pct = comparison?.pct ?? null;
  }

  const inflation = bestInflationAnchor(drops);

  return {
    venueId: venue.id,
    venueName: venue.name,
    baseline,
    now,
    deltaGbp,
    pct,
    inflation,
    isEmpty: !baseline && !now && !inflation,
  };
}
