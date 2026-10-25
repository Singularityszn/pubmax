import { expect, it } from "vitest";
import { namedNonBeerBundleUpdates } from "@/lib/venuePriceUpdates";
import type { UkPriceBundleRow } from "@/lib/ukPriceBundle";
const coffee: UkPriceBundleRow = { venueId: "pub-1", name: "Pub", category: "coffee", priceGbp: 2.5, lane: "site-harvest", standing: "listed", sourceUrl: "https://example.com/menu", publisher: "example.com", observedAt: "2026-10-25T10:00:00Z", basis: null, sampleSize: null, drinkLabel: "Single Espresso" };
it("carries a named coffee observation and its source date to the published menu lane", () => {
  expect(namedNonBeerBundleUpdates([coffee], Date.parse("2026-10-25T12:00:00Z"))).toEqual([{ venueKey: "pub-1", drinkName: "Single Espresso", category: "coffee", priceGbp: 2.5, source: { label: "example.com", url: "https://example.com/menu", licence: "Published menu price facts" }, observedAt: coffee.observedAt, lane: "publisher" }]);
});
it("keeps liqueurs, neighbouring spirits, unlabelled and expired rows out of the menu adapter", () => {
  expect(namedNonBeerBundleUpdates([{ ...coffee, drinkLabel: "Cazcabel Coffee" }, { ...coffee, drinkLabel: "Patrón Silver" }, { ...coffee, drinkLabel: undefined }, { ...coffee, observedAt: "2024-01-01" }, { ...coffee, category: "alcohol-free", drinkLabel: "Espolon Reposado 40%" }], Date.parse("2026-10-25T12:00:00Z"))).toEqual([]);
});
it("preserves the listed alcohol-free glass price and never creates a community observation", () => {
  const rows = namedNonBeerBundleUpdates([{ ...coffee, category: "alcohol-free", priceGbp: 8.6, drinkLabel: "Nooh La Coste Rosé, Provence 22kcal per 125ml serve Glass" }], Date.parse("2026-10-25T12:00:00Z"));
  expect(rows[0]).toMatchObject({ category: "alcohol-free", priceGbp: 8.6, lane: "publisher", observedAt: coffee.observedAt });
});
