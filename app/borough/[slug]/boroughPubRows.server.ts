import "server-only";

import { displayDrinkName } from "@/components/listing/displayCase";
import { selectedComparableVenuePint } from "@/lib/comparableVenuePint";
import { isComparablePintServing } from "@/lib/comparablePint.mjs";
import { priceBand, priceBandAreaForVenue, type PriceBand } from "@/lib/priceBand";
import { venuePriceEvidence, type VenuePriceEvidence } from "@/lib/venuePriceEvidence";
import { venueBundlePrices, venuePriceLane, venueSourcedPrice } from "@/lib/venuePriceLane";
import { formatPrice, type Venue } from "@/lib/venues";

export type BoroughPubListRow = {
  id: string;
  name: string;
  pintLabel: string | null;
  price: { label: string; variant: "baseline" | "current"; band: PriceBand | null } | null;
  evidence: Pick<VenuePriceEvidence, "drinkLabel" | "servingSize" | "publisher" | "sourceKind" | "observedOn"> | null;
};

export function boroughPubRowData(pub: Venue): BoroughPubListRow {
  // Only an absent lane means "No price". This bundled read has no Pint Drops.
  const lane = venuePriceLane(
    pub,
    pub.latestContributorPrice,
    venueSourcedPrice(pub),
    venueBundlePrices(pub),
  );
  const figure = lane === null ? null : lane.lane === "contributor"
    ? lane.contributorPrice
    : lane.lane === "listed"
      ? lane.listed.priceGbp
      : lane.lane === "provisional"
        ? lane.provisionalPrice
        : lane.lane === "estimate"
          ? lane.estimate.priceGbp
          : pub.cheapestPrice;
  const serving = selectedComparableVenuePint(pub, null, true) ?? pub;
  const pintServing = isComparablePintServing({
    measure: "measure" in serving ? serving.measure : undefined,
    cheapestPint: "cheapestPint" in serving ? serving.cheapestPint : undefined,
  });
  const band = lane?.lane === "anchor" || !pintServing
    ? null : priceBand(figure, priceBandAreaForVenue(pub.id));
  const evidence = typeof figure === "number" ? venuePriceEvidence(pub, figure, true) : null;
  return {
    id: pub.id,
    name: pub.name,
    pintLabel: !evidence && pub.cheapestPint ? displayDrinkName(pub.cheapestPint) : null,
    price: lane === null ? null : {
      label: formatPrice(figure),
      variant: lane.lane === "baseline" ? "baseline" : "current",
      band,
    },
    evidence: evidence ? {
      drinkLabel: evidence.drinkLabel,
      servingSize: evidence.servingSize,
      publisher: evidence.publisher,
      sourceKind: evidence.sourceKind,
      observedOn: evidence.observedOn,
    } : null,
  };
}
