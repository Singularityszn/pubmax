import PriceBadge from "@/components/PriceBadge";
import type { VenuePriceReadStatus } from "@/lib/mapExperienceLens";
import type { PintTrustState } from "@/lib/pintTrust";
import { priceBand, priceBandAreaForVenue, priceBandClass } from "@/lib/priceBand";
import { peekPriceChip } from "@/lib/pubMap";
import type { VenueDropReadStatus } from "@/lib/venueDropRead";
import {
  PRICE_PENDING_LINE,
  venuePriceFallbackPending,
  type VenueBundlePrices,
  type VenuePriceLane,
} from "@/lib/venuePriceLane";

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
}) {
  const pricePending = isPub && venuePriceFallbackPending(
    lane,
    detailLoading ? "loading" : priceReadStatus,
    dropReadStatus,
  );
  if (pricePending) return <span role="status">{PRICE_PENDING_LINE}</span>;

  const price = peekPriceChip(lane, bundle, pintTrust);
  if (price) {
    const band = priceBand(price.priceGbp, priceBandAreaForVenue(venueId));
    return (
      <span
        data-pint-trust={price.trust ?? undefined}
        data-venue-id={price.trust ? venueId : undefined}
      >
        {price.observed ? (
          <PriceBadge band={band}>{price.figure}</PriceBadge>
        ) : (
          <strong className={priceBandClass(band) || undefined}>{price.figure}</strong>
        )}
        <small>{price.caption}</small>
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
