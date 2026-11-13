// London pint prices move by fare zone, not pub by pub, so a pub with no
// recorded price reads its zone's published median as an estimate. It is never
// a recorded price: `priceStandingFigure` keeps the "est." on it and
// `standingCarriesAuthority` keeps it out of every ranking and cheapest list.
// Only the published index (one with `computedAt`) estimates: a roll-up of the
// map cells a client happened to load would move as the reader pans.

import {
  priceStandingFor,
  type EstimatedPriceInput,
  type PriceStandingDecision,
} from "@/lib/priceTier";
import { venueBundlePrices, venuePriceLane, venueSourcedPrice } from "@/lib/venuePriceLane";
import { isComparablePintServing } from "@/lib/comparablePint.mjs";
import { recordedPintVenueIdsFromSlimPayload, rowsFromSlimPayload } from "@/lib/slimPayload";
import { isPubVenueKind } from "@/lib/venueKindFilters";
import { isVenueKind, type Venue, type VenueKind } from "@/lib/venues";
import {
  computeZonePintIndex,
  toZoneId,
  zoneLabel,
  type ZoneId,
  type ZonePintIndex,
} from "@/lib/zones";

const ZONE_MEDIAN_BASIS = "zone_median";

function toFinite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * `undefined` means "a row from before the vocabulary existed", which
 * `computeZonePintIndex` counts as a pub. A kind this build does not hold is a
 * different answer: the row NAMES something, we just do not know what, so it
 * lands on the neutral kind and stays out of the median. A price authority
 * fails closed.
 */
function toSlimKind(value: unknown): VenueKind | undefined {
  if (value === undefined || value === null) return undefined;
  return isVenueKind(value) ? value : "other";
}

/**
 * The published zone index from a WHOLE slim payload (public/data/venues_slim.json).
 * The server reads the file and the Plan composer fetches the same file, so
 * both derive one set of medians. A partial payload (map cells) must not come
 * here: it is not the published index.
 */
export function zonePintIndexFromSlimPayload(payload: unknown, computedAt: string): ZonePintIndex {
  const rows = rowsFromSlimPayload(payload) ?? [];
  const recordedPintVenueIds = recordedPintVenueIdsFromSlimPayload(payload);
  return {
    ...computeZonePintIndex(
      rows.map((item) => {
        const row = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
        return {
          zone: toFinite(row.zone),
          cheapestPrice: isComparablePintServing(row) ? toFinite(row.cheapestPrice) : null,
          kind: toSlimKind(row.kind),
        };
      }),
    ),
    computedAt,
    ...(recordedPintVenueIds ? { recordedPintVenueIds } : {}),
  };
}

export type ZonePriceEstimate = EstimatedPriceInput & {
  basis: typeof ZONE_MEDIAN_BASIS;
  zone: ZoneId;
};

/** The estimate for a pub in `zone`, or null when the zone publishes no median. */
export function zonePriceEstimate(
  zone: unknown,
  index: ZonePintIndex | null | undefined,
): ZonePriceEstimate | null {
  const zoneId = toZoneId(zone);
  if (zoneId === null || !index?.computedAt) return null;
  const row = index.rows.find((entry) => entry.zone === zoneId);
  if (!row?.enough || row.medianGbp === null || !Number.isFinite(row.medianGbp)) return null;
  return {
    priceGbp: row.medianGbp,
    basis: ZONE_MEDIAN_BASIS,
    sampleSize: row.pricedCount,
    computedAt: index.computedAt,
    zone: zoneId,
  };
}

/**
 * One London pub, one estimate. The zone estimate replaces the older borough
 * baseline the UK price bundle carries, so the pin, the list, the sheet and the
 * Ledger print one figure. A chain-menu estimate is the narrower claim and
 * stays. Recorded prices never pass through here: they outrank every estimate
 * in `venuePriceLane`.
 */
export function withZoneEstimate<Bundle extends { estimate?: EstimatedPriceInput | null }>(
  bundle: Bundle,
  zone: unknown,
  index: ZonePintIndex | null | undefined,
): Bundle {
  if (bundle.estimate?.basis.startsWith("chain_menu")) return bundle;
  const estimate = zonePriceEstimate(zone, index);
  return estimate ? { ...bundle, estimate } : bundle;
}

/** The sentence under an estimate, naming its zone and its sample. */
export function zoneEstimateNote(estimate: ZonePriceEstimate): string {
  return `Estimate: the middle of ${estimate.sampleSize} recorded pint prices in ${zoneLabel(estimate.zone)}.`;
}

/** The basis line for an estimate a surface holds, or null unless it is a zone estimate. */
export function zoneEstimateBasisNote(estimate: EstimatedPriceInput | null | undefined): string | null {
  if (estimate?.basis !== ZONE_MEDIAN_BASIS) return null;
  const zone = toZoneId((estimate as ZonePriceEstimate).zone);
  return zone === null ? null : zoneEstimateNote({ ...(estimate as ZonePriceEstimate), zone });
}

/**
 * Only pins without a recorded price in their available lanes and signals
 * receive an estimate standing. This does not establish complete public-price
 * absence. See docs/rules/lib-prices-trust-and-drinks.md#london-zone-estimates.
 */
export function zoneEstimatePinStandings(
  venues: readonly Venue[],
  signals: ReadonlyMap<string, { latestContributorPrice: number | null; pintTrust?: unknown }>,
  index: ZonePintIndex | null | undefined,
): ReadonlyMap<string, PriceStandingDecision> | null {
  if (!index?.computedAt) return null;
  const standings = new Map<string, PriceStandingDecision>();
  for (const venue of venues) {
    if (!isPubVenueKind(venue.kind)) continue;
    const signal = signals.get(venue.id);
    const lane = venuePriceLane(venue, signal?.latestContributorPrice, venueSourcedPrice(venue), venueBundlePrices(venue, index));
    if (lane && lane.lane !== "estimate") continue;
    if (signal?.pintTrust && signal.pintTrust !== "none") continue;
    if (lane?.lane === "estimate") standings.set(venue.id, priceStandingFor({ estimate: lane.estimate }));
  }
  return standings;
}
