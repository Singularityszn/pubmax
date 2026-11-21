import { formatGbp } from "@/lib/formatGbp";
import type { MapLensPrice } from "@/lib/mapExperienceLens";
import { anchorSourceLabel } from "@/lib/venueAnchorPresentation";
import { venueBundlePrices, venuePriceLane, venuePriceLaneObservedGbp, venueSourcedPrice } from "@/lib/venuePriceLane";
import type { Venue } from "@/lib/venues";
import type { ZonePintIndex } from "@/lib/zones";

export type MapListPriceEvidence = {
  priceGbp: number;
  priceLabel: string;
  sourceLabel: string;
  dateLabel: string;
  dateKind: "Read" | "Logged";
};

type Signal = { latestContributorPrice: number | null; latestContributorAt?: number | null };

const dateFormat = new Intl.DateTimeFormat("en-GB", {
  day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
});

function datedPrice(
  priceGbp: number | null,
  source: string | null | undefined,
  observedAt: string | number | null | undefined,
  dateKind: MapListPriceEvidence["dateKind"] = "Read",
  itemLabel?: string,
): MapListPriceEvidence | null {
  const sourceLabel = source?.trim();
  if (priceGbp === null || !Number.isFinite(priceGbp) || priceGbp < 0 || !sourceLabel || observedAt == null || observedAt === "") return null;
  const instant = typeof observedAt === "number" ? observedAt : Date.parse(observedAt);
  if (!Number.isFinite(instant)) return null;
  const figure = formatGbp(priceGbp);
  return { priceGbp, priceLabel: itemLabel ? `${itemLabel} · ${figure}` : figure, sourceLabel, dateLabel: dateFormat.format(instant), dateKind };
}

/** Read the winning lane's own evidence. Missing evidence never borrows another lane's date. */
export function mapVenueListPriceEvidence(
  venue: Venue,
  signal: Signal | undefined,
  lensPrices: ReadonlyMap<string, MapLensPrice> | null,
  zoneIndex: ZonePintIndex | null,
): MapListPriceEvidence | null {
  if (lensPrices !== null) {
    const price = lensPrices.get(venue.id);
    if (!price) return null;
    return datedPrice(price.priceGbp,
      price.source === "community" ? "Drinker reports" : anchorSourceLabel(price.sourceUrl),
      price.observedAt ?? price.submittedAt,
      price.source === "community" ? "Logged" : "Read", price.categoryLabel);
  }
  const lane = venuePriceLane(venue, signal?.latestContributorPrice, venueSourcedPrice(venue), venueBundlePrices(venue, zoneIndex));
  if (!lane) return null;
  const figure = venuePriceLaneObservedGbp(lane);
  switch (lane.lane) {
    case "anchor":
      return datedPrice(figure, anchorSourceLabel(venue.anchorSourceUrl), venue.anchorObservedAt, "Read", lane.anchorLabel);
    case "contributor":
      return datedPrice(figure, "Drinker reports", signal?.latestContributorAt, "Logged");
    case "sourced":
      return datedPrice(figure, lane.sourcedPrice.sourceLabel, lane.sourcedPrice.observedAt);
    case "listed":
      return datedPrice(figure, lane.listed.publisher ?? anchorSourceLabel(lane.listed.sourceUrl), lane.listed.observedAt);
    case "baseline":
      return datedPrice(figure, lane.publisher?.label ?? lane.listedIndex?.label, lane.observedOn);
    default:
      return null;
  }
}
