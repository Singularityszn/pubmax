import PriceBadge from "@/components/PriceBadge";
import { DROP_READ_UNAVAILABLE_LINE, firstDropNudgeMayClaimAbsence } from "@/lib/firstDropNudge";
import type { VenuePriceReadStatus } from "@/lib/mapExperienceLens";
import type { PintTrustState } from "@/lib/pintTrust";
import { priceBand, priceBandAreaForVenue, priceBandClass } from "@/lib/priceBand";
import { priceAgeFor } from "@/lib/priceTier";
import { peekPriceChip } from "@/lib/pubMap";
import type { VenueDropReadStatus } from "@/lib/venueDropRead";
import {
  PRICE_PENDING_LINE,
  venuePriceFallbackPending,
  type VenueBundlePrices,
  type VenuePriceLane,
} from "@/lib/venuePriceLane";

/** The peek's short word for an aging figure; the Overview says the whole why. */
export const PEEK_AGING_SUFFIX = " · may have changed";

/**
 * Whether the peek's figure is a published price past its window (owner
 * decision 16 Oct 2026: an aging price must look aging, never fresh). The two
 * lanes that print a dated published figure are judged here; a drinker's
 * report already names its own state in the trust line.
 */
export function peekPriceAging(lane: VenuePriceLane | null): boolean {
  if (lane?.lane === "baseline") return priceAgeFor("published", lane.observedOn) === "aging";
  if (lane?.lane === "sourced") return priceAgeFor("published", lane.sourcedPrice.observedAt) === "aging";
  return false;
}

export default function VenuePeekPintPrice({
  venueId,
  isPub,
  lane,
  bundle,
  pintTrust,
  detailLoading,
  priceReadStatus,
  dropReadStatus,
  onLog,
  dated = null,
}: {
  venueId: string;
  isPub: boolean;
  lane: VenuePriceLane | null;
  bundle: VenueBundlePrices;
  pintTrust: PintTrustState | null;
  detailLoading: boolean;
  priceReadStatus: VenuePriceReadStatus;
  dropReadStatus: VenueDropReadStatus;
  onLog: () => void;
  /** The date the Overview prints beside this lane's figure
   *  (lib/venueActionCard.ts), so the action card says how old the price is. */
  dated?: string | null;
}) {
  const pricePending = isPub && venuePriceFallbackPending(
    lane,
    detailLoading ? "loading" : priceReadStatus,
    dropReadStatus,
  );
  if (pricePending) return <span role="status">{PRICE_PENDING_LINE}</span>;

  const price = peekPriceChip(lane, bundle, pintTrust);
  if (isPub && !price?.observed && !firstDropNudgeMayClaimAbsence(dropReadStatus)) {
    return <span role="status"><small>{DROP_READ_UNAVAILABLE_LINE}</small></span>;
  }
  if (price) {
    const band = priceBand(price.priceGbp, priceBandAreaForVenue(venueId));
    const aging = peekPriceAging(lane);
    return (
      <span
        data-pint-trust={price.trust ?? undefined}
        data-venue-id={price.trust ? venueId : undefined}
      >
        {price.observed ? (
          <PriceBadge band={band} className={aging ? "priceBadge--aging" : undefined}>
            {price.figure}
          </PriceBadge>
        ) : (
          <strong className={priceBandClass(band) || undefined}>{price.figure}</strong>
        )}
        <small>
          {price.caption}
          {aging ? PEEK_AGING_SUFFIX : null}
        </small>
        {dated ? <small data-price-dated="">{dated}</small> : null}
      </span>
    );
  }
  return isPub ? (
    <button type="button" className="mobileVenuePeekDrop" onClick={onLog}>
      <strong>No price yet.</strong>
      <small>Be the first →</small>
    </button>
  ) : null;
}
