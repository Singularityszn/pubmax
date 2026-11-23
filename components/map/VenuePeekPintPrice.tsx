import PriceBadge from "@/components/PriceBadge";
import PriceSourceName from "@/components/venue/PriceSourceName";
import EstimateLegend from "@/components/ui/estimate-legend";
import { useDealPrices } from "@/components/map/useDealPrices";
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
 * Who published the figure, at every width. lib/priceSourceLink.ts decides
 * link, refused or missing. A slim index stamp names its publisher before the
 * detail rows bring the link, so it is plain text that becomes the link, not a
 * refusal. A baseline lane with no publisher says so in its caption, so it
 * answers null here and is not said twice.
 */
type PillSource =
  | { kind: "named"; label: string }
  | { kind: "record"; label: string | null | undefined; url: string | null | undefined };

function priceSource(lane: VenuePriceLane | null): PillSource | null {
  if (!lane) return null;
  if (lane.lane === "baseline") {
    if (lane.publisher) return { kind: "record", label: lane.publisher.label, url: lane.publisher.url };
    const indexed = lane.listedIndex?.label.trim();
    return indexed ? { kind: "named", label: indexed } : null;
  }
  if (lane.lane === "sourced") return { kind: "record", label: lane.sourcedPrice.sourceLabel, url: lane.sourcedPrice.sourceUrl };
  if (lane.lane === "listed") return { kind: "record", label: lane.listed.publisher, url: lane.listed.sourceUrl };
  return null;
}

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
  /** Opens the composer from "No price yet". Absent when the card's coral is
   *  already "Log what you paid" (lib/venuePlanDoor.ts), so the cell only says. */
  onLog?: () => void;
  /** The date the Overview prints beside this lane's figure
   *  (lib/venueActionCard.ts), so the action card says how old the price is. */
  dated?: string | null;
}) {
  const deals = useDealPrices(venueId, isPub && lane === null && !detailLoading);
  const hasDeals = deals.deals.length > 0;
  const pricePending = isPub && venuePriceFallbackPending(
    lane,
    detailLoading ? "loading" : priceReadStatus,
    dropReadStatus,
  );
  if (pricePending) return <span role="status">{PRICE_PENDING_LINE}</span>;

  const price = peekPriceChip(lane, bundle, pintTrust);
  const source = priceSource(lane);
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
        {price.observed ? <small>
          {price.caption}
          {aging ? PEEK_AGING_SUFFIX : null}
        </small> : <EstimateLegend />}
        {dated ? <small data-price-dated="">{dated}</small> : null}
        {source ? (
          <small className="venuePeekSource" data-price-source="">
            {source.kind === "named" ? source.label : <PriceSourceName className="priceSourceLink" label={source.label} url={source.url} />}
          </small>
        ) : null}
      </span>
    );
  }
  if (!isPub) return null;
  if (deals.status !== "ready") {
    return <span role="status"><small>{deals.status === "loading" ? "Checking deals…" : "Deal information is unavailable right now."}</small></span>;
  }
  // With no figure, `dated` is only ever an expired listing's own line
  // (lib/venueActionCard.ts), so the pub is not invited to be the first.
  const headline = dated ? "No current price." : hasDeals ? "No regular price yet." : "No price yet.";
  if (!onLog) {
    return (
      <span>
        <strong>{headline}</strong>
        <small data-price-age={dated ? "old" : undefined}>{dated ?? (hasDeals ? "Log a regular price" : "Be the first to log one")}</small>
      </span>
    );
  }
  return (
    <button type="button" className="mobileVenuePeekDrop" onClick={onLog}>
      <strong>{headline}</strong>
      <small data-price-age={dated ? "old" : undefined}>{dated ?? (hasDeals ? "Log a regular price →" : "Be the first →")}</small>
    </button>
  );
}
