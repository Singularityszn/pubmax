import { lastOf } from "@/lib/tuple";
import { isWithinMaxAge } from "@/lib/communityPrice";
import type { Provenance } from "@/lib/curation";
import { AGED_PRICE_LINE, venueSourcedPrice } from "@/lib/venuePriceLane";
import { formatFreshness, hasPintPriceSemantics, type Venue } from "@/lib/venues";
import { selectedVenuePintEvidence } from "@/lib/comparableVenuePint";
import { namedLegacyPintPriceSource } from "@/lib/legacyPriceEvidence.mjs";
import { drinkMeasureName, measureFromServingSize, measureNamedInDrinkText, statedDrinkMeasure, type DrinkMeasure } from "@/lib/drinkMeasure";
import { drinkAgreementKey } from "@/lib/pintDropAgreement";
import { isComparablePintServing, pintObservationTime } from "@/lib/comparablePint.mjs";
import { firstHttp } from "@/lib/httpUrl";

// "Then vs Now" — connect a venue's baseline dataset price ("then") to the most
// recent community-reported Pint Drop price ("now"). Pure/testable: no fetch, no
// React, no side effects. The /discover page feeds it grouped Venue[] plus the
// public drops from GET /api/pint-drops and renders the result.

// The minimal community-drop shape computeThenVsNow reads. The public
// /api/pint-drops DTO satisfies this (it carries venueId, priceGbp, createdAt);
// callers narrow the API payload to this before passing it in.
export type ThenVsNowDrop = {
  venueId: string;
  priceGbp: number | null;
  createdAt: string;
};

// The "then" half: the three fields this reads off a venue and nothing else. A
// grouped `Venue` satisfies it, and so does a baseline row cut at build time
// (lib/discoverBoard.ts), so asking for a comparison never means downloading
// the whole priced dataset to a browser.
export type ThenVsNowVenue = {
  id: string;
  name: string;
  cheapestPrice: number | null;
};

// One resolved comparison row, ready to hand straight to a card.
// - thenGbp  = the venue's baseline/dataset cheapest price
// - nowGbp   = the price on the most-recent priced community drop for that venue
// - deltaGbp = nowGbp - thenGbp (positive → gone up, negative → gone down)
// - pct      = deltaGbp / thenGbp * 100 (0 when thenGbp is 0, guarded)
export type ThenVsNowItem = {
  venueId: string;
  venueName: string;
  thenGbp: number;
  nowGbp: number;
  deltaGbp: number;
  pct: number;
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

// The most-recent priced drop for a venue: filter to drops carrying a usable
// price, then pick the newest by createdAt (ISO strings sort lexicographically).
// Returns null when the venue has no priced community drop at all.
function mostRecentPricedDrop(drops: ThenVsNowDrop[]): ThenVsNowDrop | null {
  let best: ThenVsNowDrop | null = null;
  for (const drop of drops) {
    if (!isFiniteNumber(drop.priceGbp)) continue;
    if (!best || drop.createdAt.localeCompare(best.createdAt) > 0) best = drop;
  }
  return best;
}

// Build the "Then vs Now" rows. A venue only qualifies when it carries BOTH
// signals: a baseline `cheapestPrice` ("then") AND at least one priced community
// drop ("now"). Venues missing either are silently ignored.
//
// Ranking: biggest movers first — by absolute delta descending (the drops that
// tell the most striking price story lead), ties broken on venue name so the
// order is deterministic across renders. `limit` caps the returned list.
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
    const deltaGbp = nowGbp - thenGbp;
    const pct = thenGbp !== 0 ? (deltaGbp / thenGbp) * 100 : 0;

    items.push({
      venueId: venue.id,
      venueName: venue.name,
      thenGbp,
      nowGbp,
      deltaGbp,
      pct,
    });
  }

  return items
    .sort(
      (a, b) =>
        Math.abs(b.deltaGbp) - Math.abs(a.deltaGbp) ||
        a.venueName.localeCompare(b.venueName),
    )
    .slice(0, Math.max(0, limit));
}

// ────────────────────────────────────────────────────────────────────────────
// The Golden Thread resolves selected price evidence for the venue sheet.
// CPI helpers remain available, but the current report contract cannot date
// a historical price independently of its memory's era.
// ────────────────────────────────────────────────────────────────────────────

// UK CPI (all items, 2015 = 100) decadal anchors, annual averages. Post-1988
// values are ONS series D7BT; pre-1988 use the ONS long-run modelled CPI
// back-series, rounded to the tenth. These are the only "inflation" numbers in
// the app, kept as a compact anchor table so the math stays deterministic and
// unit-testable offline (no live index fetch). We linearly interpolate BETWEEN
// anchors and clamp OUTSIDE the covered range, so a stray year never throws.
type CpiAnchor = readonly [year: number, index: number];
const CPI_ANCHORS: readonly [CpiAnchor, ...CpiAnchor[]] = [
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
export const INFLATION_TODAY_YEAR = lastOf(CPI_ANCHORS)[0];

// The CPI index for a year, linearly interpolated between the nearest anchors
// and clamped to the endpoint index outside the covered range. Returns null
// only for a non-finite year.
export function cpiIndexForYear(year: number): number | null {
  if (!isFiniteNumber(year)) return null;
  const first = CPI_ANCHORS[0];
  const last = lastOf(CPI_ANCHORS);
  if (year <= first[0]) return first[1];
  if (year >= last[0]) return last[1];
  for (const [i, [hiYear, hiIdx]] of CPI_ANCHORS.entries()) {
    const previous = CPI_ANCHORS[i - 1];
    if (!previous) continue;
    const [loYear, loIdx] = previous;
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

// Pull a memory year out of a free-text era string. Community era tags
// look like "Dad's rule, 1980s", "The wedding, 1971", "Nan's shift, 1950s".
// A decade resolves to its midpoint, such as 1985 for the 1980s. Otherwise,
// use a bare four-digit year. This does not date a logged price.
// Only years from 1900 to INFLATION_TODAY_YEAR count.
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
  isFresh?: boolean;
  // The label describes the record's status. Its dates stay in evidence,
  // because a log date does not necessarily date the price.
  label: string;
  evidence: {
    drink: string | null;
    serving: string | null;
    publisher: string | null;
    sourceUrl: string | null;
    recordedAt: string | null;
    dateKind: "read" | "logged";
    /** A memory can have a known log date without a known price date. */
    priceDateKnown?: boolean;
    linkUnavailable?: boolean;
  };
};

// A historical adjustment needs a dated price observation. A parsed memory
// era alone cannot supply one.
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
  // The selected record, omitted when now already displays that same report.
  baseline: VenuePriceStamp | null;
  // The newest priced community drop, when present. Its label says whether it
  // is still fresh enough to describe as tonight's price.
  now: VenuePriceStamp | null;
  // comparableStoryPrices owns whether these differences can be claimed.
  deltaGbp: number | null;
  pct: number | null;
  // Reserved for a historical price with its own observation date. An era
  // belongs to the memory, so the current drop contract cannot supply this.
  inflation: VenueInflationAnchor | null;
  // True when there is nothing to show at all — the surface renders its honest
  // empty state ("no price story on record yet").
  isEmpty: boolean;
};

// The public fields needed by the venue story. VenueInspector already holds
// full Pint Drops, including their public-safe attribution.
export type VenuePriceStoryDrop = ThenVsNowDrop & {
  drink?: string | null;
  measure?: DrinkMeasure | null;
  measureLabel?: string | null;
  era?: string | null;
  handle?: string | null;
  provenance: Provenance;
};

function reportedServing(drop: VenuePriceStoryDrop): string | null {
  const measure = drop.measure === undefined
    ? measureNamedInDrinkText(drop.drink ?? "") ?? "pint"
    : statedDrinkMeasure(drop.measure);
  if (!measure) return null;
  if (measure === "other") return drop.measureLabel?.trim() || null;
  return drinkMeasureName(measure).toLowerCase();
}

function comparableStoryPrices(baseline: VenuePriceStamp, report: VenuePriceStamp, now: number): boolean {
  const drinkKey = (stamp: VenuePriceStamp) => drinkAgreementKey({ drink: stamp.evidence.drink ?? "", priceGbp: stamp.gbp });
  const servingKey = (stamp: VenuePriceStamp) => measureFromServingSize(stamp.evidence.serving)
    ?? (stamp.evidence.serving?.trim().toLowerCase().replace(/\s+/g, " ") || null);
  const baselineAt = pintObservationTime(baseline.evidence.recordedAt, now);
  const reportAt = pintObservationTime(report.evidence.recordedAt, now);
  return report.isFresh === true && baseline.gbp > 0 && report.gbp > 0
    && baseline.evidence.priceDateKnown !== false && report.evidence.priceDateKnown !== false
    && baseline.provenance !== "demo" && baseline.provenance !== "anecdote"
    && drinkKey(baseline) !== null && drinkKey(baseline) === drinkKey(report)
    && servingKey(baseline) !== null && servingKey(baseline) === servingKey(report)
    && Boolean(baseline.evidence.publisher && report.evidence.publisher)
    && baselineAt !== null && reportAt !== null && baselineAt < reportAt;
}

function communityPriceStamp(drop: VenuePriceStoryDrop, now: number): VenuePriceStamp | null {
  if (!isFiniteNumber(drop.priceGbp)) return null;
  const submittedAt = pintObservationTime(drop.createdAt, now);
  // Only the current log's empty era or explicit Tonight preset dates the
  // price. Other eras can describe a memory beside an unrelated price.
  const era = drop.era?.trim().toLowerCase();
  const priceDateKnown = (!era || era === "tonight") && drop.provenance === "contributor";
  const isFresh = priceDateKnown && submittedAt !== null && isWithinMaxAge({ submittedAt }, now);
  const freshness = submittedAt === null ? "Log date unknown" : formatFreshness(drop.createdAt, new Date(now));
  return {
    gbp: drop.priceGbp,
    provenance: drop.provenance,
    isFresh,
    label: !priceDateKnown
      ? "Reported price"
      : submittedAt === null
      ? "Community report · log date unknown"
      : isFresh ? "Community tonight" : [freshness, AGED_PRICE_LINE].join(" · "),
    evidence: {
      drink: drop.drink?.trim() || null,
      serving: reportedServing(drop),
      publisher: drop.handle?.trim() ? `Reported by ${drop.handle.trim()}` : null,
      sourceUrl: null,
      recordedAt: submittedAt === null ? null : new Date(submittedAt).toISOString(),
      dateKind: "logged",
      ...(!priceDateKnown ? { priceDateKnown: false } : {}),
    },
  };
}

/** A date belonging to this price record, not a later collection stamp. */
function priceRecordDate(value: unknown, now: number): string | null {
  const at = pintObservationTime(value, now);
  return at === null ? null : new Date(at).toISOString();
}

type SelectedPriceRecord = { stamp: VenuePriceStamp; report: VenuePriceStoryDrop | null };

function selectedPriceRecord(venue: Venue, drops: VenuePriceStoryDrop[], now: number): SelectedPriceRecord | null {
  const gbp = venue.cheapestPrice;
  if (!isFiniteNumber(gbp)) return null;

  // A refresh owns the amount even when a dataset row has the same number.
  // The refresh contract records no drink or serving.
  const update = venueSourcedPrice(venue);
  if (update) {
    const sourceUrl = firstHttp(update.sourceUrl) || null;
    return {
      report: null,
      stamp: {
          gbp,
          provenance: update.provenance,
          label: "Listed update on record",
          evidence: {
            drink: null,
            serving: null,
            publisher: update.sourceLabel.trim() || null,
            sourceUrl,
            recordedAt: priceRecordDate(update.observedAt, now),
            dateKind: "read",
            ...(update.sourceUrl.trim() && !sourceUrl ? { linkUnavailable: true } : {}),
          },
        },
      };
    }

    if (venue.latestContributorPrice === gbp && venue.latestContributorAt) {
      const selectedAt = Date.parse(venue.latestContributorAt);
      const matching = drops.filter((drop) => drop.venueId === venue.id
        && drop.provenance === "contributor" && drop.priceGbp === gbp
        && Date.parse(drop.createdAt) === selectedAt && drop.drink === venue.cheapestPint);
      // Multiple matching reports cannot identify whose attribution was selected.
      const selectedStamp = matching.length === 1 ? communityPriceStamp(matching[0]!, now) : null;
      return {
        report: matching.length === 1 ? matching[0]! : null,
        stamp: {
          ...(selectedStamp ?? {
            gbp,
            provenance: "contributor",
            evidence: {
              drink: venue.cheapestPint.trim() || null,
              serving: null,
              publisher: null,
              sourceUrl: null,
              recordedAt: priceRecordDate(venue.latestContributorAt, now),
              dateKind: "logged",
              priceDateKnown: false,
            },
          }),
          label: "Community price on record",
        },
      };
    }

    const selected = selectedVenuePintEvidence(venue, now);
    const row = venue.prices?.find((price) => price.price_gbp === gbp);
    const source = row ? namedLegacyPintPriceSource(row) : null;
    const namedMeasure = measureNamedInDrinkText(selected.cheapestPint ?? "");
    const legacyServing = row && hasPintPriceSemantics(venue)
      ? namedMeasure ? drinkMeasureName(namedMeasure).toLowerCase()
        : isComparablePintServing({ cheapestPint: selected.cheapestPint }) ? "pint" : null
      : null;
    return {
      report: null,
      stamp: {
      gbp,
      provenance: venue.curation.provenance ?? "sourced",
      label: "Baseline on record",
      evidence: {
        drink: selected.cheapestPint?.trim() || null,
        serving: selected.measure?.trim() || legacyServing,
        publisher: selected.priceSource === "app-dataset" ? null : selected.priceSource?.trim() || null,
        sourceUrl: source?.url ?? null,
        recordedAt: priceRecordDate(selected.priceObservedAt, now),
        dateKind: "read",
      },
    },
  };
}

/** Resolve each displayed amount from its own selected record. */
export function computeVenuePriceStory(
  venue: Venue,
  drops: VenuePriceStoryDrop[],
  now: number = Date.now(),
): VenuePriceStory {
  const selected = selectedPriceRecord(venue, drops, now);
  const nowDrop = mostRecentPricedDrop(drops.filter((drop) => drop.venueId === venue.id)) as VenuePriceStoryDrop | null;
  const nowStamp = nowDrop ? communityPriceStamp(nowDrop, now) : null;
  const sameReport = nowDrop !== null && selected?.report === nowDrop;
  const baseline = sameReport ? null : selected?.stamp ?? null;
  const comparable = baseline && nowStamp && comparableStoryPrices(baseline, nowStamp, now);
  const deltaGbp = comparable ? nowStamp.gbp - baseline.gbp : null;
  const pct = comparable ? ((nowStamp.gbp - baseline.gbp) / baseline.gbp) * 100 : null;

  // An era dates a memory, not the numeric price beside it. The current DTO
  // carries no historical price observation, so it cannot support inflation.
  return {
    venueId: venue.id,
    venueName: venue.name,
    baseline,
    now: nowStamp,
    deltaGbp,
    pct,
    inflation: null,
    isEmpty: !baseline && !nowStamp,
  };
}
