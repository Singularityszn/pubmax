import { londonDayKey } from "@/lib/londonHour";
import type { PricedVenue } from "@/lib/priceUpdates";
import { venueListedPint, type VenueListedPint } from "@/lib/venueListedPint";
import { venuePriceLane, type VenueBundlePrices } from "@/lib/venuePriceLane";

type LedgerPriceVenue = Pick<PricedVenue, "id" | "cheapestPrice" | "cheapestPint" | "prices" | "sourcedPrice">;

export function ledgerPublishedPrice(venue: LedgerPriceVenue, bundle: VenueBundlePrices) {
  const listedPint = venueListedPint(venue);
  const pintVenue = {
    cheapestPrice: venue.sourcedPrice ? venue.cheapestPrice : listedPint?.priceGbp ?? null,
    prices: venue.prices,
  };
  const publishedLane = venuePriceLane(pintVenue, null, venue.sourcedPrice, bundle);
  let publishedPint: VenueListedPint | null = null;
  if (publishedLane?.lane === "baseline") publishedPint = listedPint;
  else if (publishedLane?.lane === "listed") {
    const { listed } = publishedLane;
    publishedPint = {
      priceGbp: listed.priceGbp,
      pintName: listed.drinkLabel ?? null,
      publisher: { label: listed.publisher ?? "", url: listed.sourceUrl },
      observedOn: londonDayKey(new Date(listed.observedAt)),
    };
  } else if (publishedLane?.lane === "sourced" && publishedLane.cheapestPrice !== null) {
    const { sourcedPrice } = publishedLane;
    publishedPint = {
      priceGbp: publishedLane.cheapestPrice,
      pintName: null,
      publisher: { label: sourcedPrice.sourceLabel, url: sourcedPrice.sourceUrl },
      observedOn: londonDayKey(new Date(sourcedPrice.observedAt)),
    };
  }
  return { pintVenue, listedPint, publishedLane, publishedPint };
}

export type LedgerPublishedPrice = ReturnType<typeof ledgerPublishedPrice>;
