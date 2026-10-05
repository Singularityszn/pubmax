// Zone-based price lens — the "a pint in Zone 1 costs more than Zone 3" play.
//
// TfL fare zones are STATION-based, not area polygons. Every venue is assigned
// the zone of its NEAREST station (see scripts/lib/stationZones.mjs, run at
// build time and stamped onto the slim index as `zone`). This module is the
// pure, client-safe maths on top of that field: the picker's zone set, the
// per-zone median "pint index", and the low-observation honesty gate. It never
// invents a number — a zone with too few priced venues is reported as such.

import { formatGbp } from "@/lib/formatGbp";
import type { VenueKind } from "@/lib/venues";

/** Filterable fare zones offered by the picker: 1–6 plus "all". */
export const ZONE_IDS = [1, 2, 3, 4, 5, 6] as const;
export type ZoneId = (typeof ZONE_IDS)[number];

/** A zone selection: a concrete zone, or "all" (no zone narrowing). */
export type ZoneSelection = ZoneId | "all";

/**
 * Minimum number of priced venues a zone needs before we publish a median.
 * Below this the zone reads "not enough pints logged yet — fix that", never a
 * shaky number pretending to be a trend.
 */
export const MIN_PRICED_VENUES = 10;

/** Short human label for a zone selection. */
export function zoneLabel(selection: ZoneSelection): string {
  return selection === "all" ? "All zones" : `Zone ${selection}`;
}

/** Coerce an unknown value to a filterable ZoneId, or null if out of 1–6. */
export function toZoneId(value: unknown): ZoneId | null {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(n)) return null;
  return (ZONE_IDS as readonly number[]).includes(n) ? (n as ZoneId) : null;
}

/** Parse a URL / query zone param ("3", "all") into a ZoneSelection or null. */
export function parseZoneParam(raw: string | null | undefined): ZoneSelection | null {
  const value = String(raw ?? "").trim().toLowerCase();
  if (!value) return null;
  if (value === "all") return "all";
  return toZoneId(value);
}

/**
 * Does a venue's zone match a selection?
 * "all" (or an empty string) matches everything. A concrete zone matches only
 * venues whose assigned zone equals it; a venue with an unknown zone (null)
 * never matches a concrete zone — honest, not guessed into a bucket.
 */
export function venueMatchesZone(
  venueZone: number | null | undefined,
  selection: ZoneSelection | "" | null | undefined,
): boolean {
  if (selection == null || selection === "" || selection === "all") return true;
  return venueZone === selection;
}

/** Median of a numeric list (average of the two middle values for even n). */
export function median(values: readonly number[]): number | null {
  const nums = values
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v))
    .sort((a, b) => a - b);
  const mid = Math.floor(nums.length / 2);
  const upper = nums[mid];
  if (upper === undefined) return null;
  const lower = nums[mid - 1];
  return nums.length % 2 === 0 && lower !== undefined ? (lower + upper) / 2 : upper;
}

/** Minimal venue shape the zone index needs. */
export type ZonePricedVenue = {
  zone?: number | null;
  cheapestPrice?: number | null;
  kind?: VenueKind;
};

/** One zone's row in the pint index. */
type ZonePintIndexRow = {
  zone: ZoneId;
  /** Median cheapest pint across priced venues in this zone, or null if gated. */
  medianGbp: number | null;
  /** Count of venues in this zone that have a numeric price. */
  pricedCount: number;
  /** True when pricedCount >= MIN_PRICED_VENUES, so medianGbp is publishable. */
  enough: boolean;
};

export type ZonePintIndex = {
  rows: ZonePintIndexRow[];
  /** Zones that cleared the observation gate, cheapest → dearest by median. */
  ranked: ZonePintIndexRow[];
  /** Dearest publishable zone (highest median), or null if none qualify. */
  dearest: ZonePintIndexRow | null;
  /** Cheapest publishable zone (lowest median), or null if none qualify. */
  cheapest: ZonePintIndexRow | null;
  /** Dearest − cheapest median across publishable zones — the "zone tax". */
  taxGbp: number | null;
};

/**
 * Compute the per-zone pint index from priced venues. Pure and deterministic:
 * groups venues by their assigned zone, takes the median of each zone's cheapest
 * pint, and gates any zone with fewer than MIN_PRICED_VENUES priced venues.
 */
export function computeZonePintIndex(venues: readonly ZonePricedVenue[]): ZonePintIndex {
  const pricesByZone = new Map<ZoneId, number[]>();
  for (const id of ZONE_IDS) pricesByZone.set(id, []);

  for (const venue of venues) {
    if (venue.kind !== undefined && venue.kind !== "pub") continue;
    const zone = toZoneId(venue.zone);
    if (zone === null) continue;
    const price = venue.cheapestPrice;
    if (typeof price !== "number" || !Number.isFinite(price)) continue;
    pricesByZone.get(zone)!.push(price);
  }

  const rows: ZonePintIndexRow[] = ZONE_IDS.map((zone) => {
    const prices = pricesByZone.get(zone)!;
    const enough = prices.length >= MIN_PRICED_VENUES;
    return {
      zone,
      pricedCount: prices.length,
      enough,
      medianGbp: enough ? median(prices) : null,
    };
  });

  const ranked = rows
    .filter((row): row is ZonePintIndexRow & { medianGbp: number } => row.medianGbp !== null)
    .sort((a, b) => a.medianGbp - b.medianGbp);

  const cheapest = ranked[0] ?? null;
  const dearest = ranked.at(-1) ?? null;
  const taxGbp =
    cheapest && dearest && cheapest !== dearest
      ? Number((dearest.medianGbp! - cheapest.medianGbp!).toFixed(2))
      : cheapest && dearest
        ? 0
        : null;

  return { rows, ranked, dearest, cheapest, taxGbp };
}

/**
 * One line for a zone that reads dearer than the zone inside it, when the
 * reason is on the page already.
 *
 * The ladder falls outwards, so Zone 6 at £4.70 over Zone 5 at £4.60 reads as
 * a mistake. It is not: those two carry the fewest priced pubs in the index
 * (45 and 51, against Zone 1's 357), and a 10p step between the two thinnest
 * samples is not an ordering anybody should trust. The audit called the silence
 * slop, and it was right - a figure that surprises a reader owes them the one
 * fact that explains it.
 *
 * What this may say is bounded hard. It states the two counts and nothing else:
 * no confidence, no interval, no "probably". And it speaks ONLY when the pair
 * really is the thin end of the index, because "small sample" would otherwise
 * be an excuse rather than a reading. An inversion between two well-sampled
 * zones gets nothing from us, which is the honest answer when we cannot explain
 * our own figure.
 */
export function zoneOrderSurpriseLine(index: ZonePintIndex): string | null {
  const publishable = index.rows
    .filter((row): row is ZonePintIndexRow & { medianGbp: number } => row.medianGbp !== null)
    .sort((a, b) => a.zone - b.zone);
  if (publishable.length < 3) return null;

  for (let i = 1; i < publishable.length; i += 1) {
    const inner = publishable[i - 1];
    const outer = publishable[i];
    if (!inner || !outer || outer.medianGbp <= inner.medianGbp) continue;
    // The pair must BE the thin end, or the sample is not the explanation.
    const thinnest = publishable
      .map((row) => row.pricedCount)
      .sort((a, b) => a - b)
      .slice(0, 2);
    const pair = [inner.pricedCount, outer.pricedCount].sort((a, b) => a - b);
    if (pair[0] !== thinnest[0] || pair[1] !== thinnest[1]) continue;
    return `Zone ${outer.zone} reads dearer than Zone ${inner.zone}. They are the thinnest samples here: ${outer.pricedCount} and ${inner.pricedCount} priced pubs.`;
  }
  return null;
}

/** "£6.40" style GBP for the index; null → en dash placeholder. */
export function formatZoneGbp(value: number | null): string {
  return typeof value === "number" ? formatGbp(value) : "–";
}
