import { averagePriceGbp, pintPriceAverages, pubCheapestPrices } from "@/lib/pintSavings";
import { isLivePriceRow } from "@/lib/priceRowEligibility.mjs";
import { groupVenuePrices, type VenuePrice } from "@/lib/venues";

/** One eligible cohort for all public price claims. Map coverage is separate. */
export function computePublicPriceStats(rows: VenuePrice[]) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const pricedRows = safeRows.filter((row) =>
    isLivePriceRow(row) && typeof row.price_gbp === "number" &&
    Number.isFinite(row.price_gbp) && row.price_gbp > 0,
  );
  const venues = groupVenuePrices(pricedRows);
  const prices = pricedRows.map((row) => row.price_gbp as number);
  const cheapestPrices = pubCheapestPrices(venues);
  return {
    venues,
    pubsTracked: venues.length,
    pintPricesObserved: prices.length,
    cheapestPint: prices.length ? Math.min(...prices) : null,
    dearestPint: prices.length ? Math.max(...prices) : null,
    averagePint: averagePriceGbp(cheapestPrices),
    averages: pintPriceAverages(cheapestPrices),
    boroughsCovered: new Set(safeRows.map((row) => (row.primary_borough ?? "").trim()).filter(Boolean)).size,
  };
}
