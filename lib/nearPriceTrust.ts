import { PINT_DATASET_OBSERVED_AT } from "@/lib/dataFreshness";
import {
  legacyPintPriceObservedAt,
  namedLegacyPintPriceSource,
  type LegacyPintPrice,
} from "@/lib/drinks";
import { formatTrustDay } from "@/lib/trustPill";

export type NearPriceTrustVenue = {
  id: string;
  cheapestPrice: number | null;
  prices: LegacyPintPrice[];
};

export type NearPriceTrustItem = {
  venueId: string;
  price: number;
  publisher: string | null;
  /** When this price's own row was last read at its source, or null when it records none. */
  observedAt: string | null;
};

export type NearPriceTrustResponse = {
  status: "ready" | "degraded";
  /** Shared Venue Dataset collection day. Never a per-row observation day. */
  collectedAt: string;
  results: NearPriceTrustItem[];
};

export type NearPriceTrustDisplayState =
  | "loading"
  | "named"
  | "unrecorded"
  | "degraded";

export const NEAR_PRICE_TRUST_COLLECTED_DATE =
  PINT_DATASET_OBSERVED_AT.toISOString().slice(0, 10);

/**
 * The list caption. It dates the pub list, never a price: each card prints its
 * own row's read, because a re-collection does not re-read every row.
 */
export const PUB_LIST_REFRESHED_CAPTION =
  `Pub list refreshed ${formatTrustDay(PINT_DATASET_OBSERVED_AT.getTime())} ${PINT_DATASET_OBSERVED_AT.getUTCFullYear()}.`;

export const NEAR_PRICE_TRUST_CAPTION =
  `${PUB_LIST_REFRESHED_CAPTION} Each price shows when it was last read.`;

/** Same exact-price and first-row authority used by the Venue sheet. */
export function resolveNearPriceTrust(
  venue: NearPriceTrustVenue,
  expectedPrice: number | null = venue.cheapestPrice,
): NearPriceTrustItem | null {
  if (
    typeof expectedPrice !== "number" ||
    !Number.isFinite(expectedPrice) ||
    expectedPrice <= 0 ||
    venue.cheapestPrice !== expectedPrice
  ) {
    return null;
  }
  const row = venue.prices.find((price) => price.price_gbp === expectedPrice);
  if (!row) return null;
  return {
    venueId: venue.id,
    price: expectedPrice,
    publisher: namedLegacyPintPriceSource(row)?.label ?? null,
    observedAt: legacyPintPriceObservedAt(row),
  };
}

/** The read behind a near-you venue's price, from its trust answer, or null when none says. */
export function nearPriceTrustObservedAt(
  results: readonly NearPriceTrustItem[],
  venueId: string,
): string | null {
  return results.find((item) => item.venueId === venueId)?.observedAt ?? null;
}

export function nearPriceTrustLabel(
  state: NearPriceTrustDisplayState,
  publisher: string | null = null,
  observedAt: string | null = null,
): string {
  if (state === "loading") return "On record · Checking publisher";
  if (state === "degraded") return "On record · Publisher could not be checked";
  const label =
    state === "unrecorded"
      ? "On record · Publisher not recorded"
      : publisher
        ? `On record · ${publisher}`
        : "On record · Publisher could not be checked";
  const readMs = observedAt ? Date.parse(observedAt) : Number.NaN;
  return Number.isFinite(readMs) ? `${label} · read ${formatTrustDay(readMs)}` : label;
}
