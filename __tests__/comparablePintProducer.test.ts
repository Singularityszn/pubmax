import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { comparablePint } from "@/lib/comparablePint.mjs";
import { comparableVenuePint } from "@/lib/comparableVenuePint";
import { measureNamedInDrinkText } from "@/lib/drinkMeasure";
import { buildSlimPriceEvidence } from "@/scripts/build_slim_index.mjs";
import { applySlimListingPrices } from "@/lib/slimListingPrices.mjs";
import { pinsToSlimVenues, slimVenueToPin } from "@/lib/slimPins";
import { mergeLazyDetailPins } from "@/lib/lazyVenueDetail";
import type { SlimVenue } from "@/lib/venuesSlim";
import type { UkPriceBundleRow } from "@/lib/ukPriceBundle";
import { buildLastOrdersPacks } from "@/scripts/build_last_orders_pack.mjs";
import { venueFromDetailArtifact } from "@/lib/venueDetailIndex";
import { legacyCheapestPriceEvidence } from "@/lib/legacyPriceEvidence.mjs";
import { isLivePriceRow } from "@/lib/priceRowEligibility.mjs";
import { priceRowReadDay } from "@/lib/priceReadDay.mjs";
import { PINT_DATASET_TEST_NOW } from "@/__tests__/helpers/pintDatasetClock";
import { DAY_MS } from "@/lib/dayMs";

describe("selected serving evidence in the published price packs", () => {
  const listing: UkPriceBundleRow = {
    venueId: "venue-10x17k9", name: "The Kings Head", category: "beer",
    priceGbp: 6.45, lane: "listing-site", standing: "listed",
    sourceUrl: "https://guinndex.co.uk/pub/kings-head-chingford-london", publisher: "Guinndex",
    observedAt: "2026-11-07T18:27:36.845Z", basis: null, sampleSize: null,
    drinkLabel: "Guinness", servingSize: "Pint",
  };
  const listingNow = Date.parse("2026-11-10T08:00:00Z");
  const unpriced = (): SlimVenue => ({
    id: listing.venueId, name: "The Kings Head", lat: 51.6318915, lng: -0.0018325,
    borough: "Waltham Forest", cheapestPrice: null,
  });

  it("keeps the recorded Kings Head Guinness through detail loading and resume", () => {
    const row = unpriced();
    const bundle = JSON.parse(readFileSync("public/data/uk_prices/rows.json", "utf8"));
    applySlimListingPrices([row], bundle, listingNow);
    expect(row).toMatchObject({
      cheapestPrice: 6.45, cheapestPint: "Guinness", measure: "pint",
      priceSource: "Guinndex", priceObservedAt: "2026-11-07",
    });
    const pin = slimVenueToPin(row);
    expect(comparableVenuePint(pin, null, false, listingNow)).toBe(6.45);
    const manifest = JSON.parse(readFileSync("data/generated/venue_detail_index.json", "utf8"));
    const entry = manifest.venues[row.id];
    const bytes = readFileSync("data/generated/venue_details.jsonl").subarray(entry.offset, entry.offset + entry.length);
    const detail = venueFromDetailArtifact(JSON.parse(bytes.toString("utf8")), row.id)!;
    expect(detail.cheapestPrice).toBeNull();
    expect(detail.prices.length).toBeGreaterThan(0);
    expect(detail.prices.every(({ price_gbp }) => price_gbp == null)).toBe(true);
    const [hydrated] = mergeLazyDetailPins([pin], new Map([[row.id, detail]]));
    expect(hydrated).toMatchObject({
      cheapestPrice: 6.45, cheapestPint: "Guinness", measure: "pint",
      priceSource: "Guinndex", priceObservedAt: "2026-11-07",
    });
    expect(comparableVenuePint(hydrated, null, false, listingNow)).toBe(6.45);
    const snapshot = pinsToSlimVenues([hydrated]);
    expect(snapshot[0]).toMatchObject(row);
    expect(comparableVenuePint(slimVenueToPin(snapshot[0]), null, false, listingNow)).toBe(6.45);
    const [resumed] = mergeLazyDetailPins([slimVenueToPin(snapshot[0])], new Map([[row.id, detail]]));
    expect(comparableVenuePint(resumed, null, false, listingNow)).toBe(6.45);
  });

  it.each([
    { lane: "estimate", standing: "estimate" },
    { category: "wine" },
    { servingSize: "Half pint" },
    { servingSize: undefined },
    { drinkLabel: "Guinness 330ml" },
    { drinkLabel: "" },
    { priceGbp: 0 },
    { priceGbp: Number.NaN },
    { sourceUrl: "invalid" },
    { publisher: null },
    { observedAt: "invalid" },
    { observedAt: "2026-11-11T08:00:00Z" },
    { venueId: "another-pub" },
  ] satisfies Partial<UkPriceBundleRow>[])("leaves the pin unpriced for an ineligible listing: %j", (change) => {
    const row = unpriced();
    applySlimListingPrices([row], [{ ...listing, ...change }], listingNow);
    expect(row).toEqual(unpriced());
  });

  it("keeps existing prices and selects one complete minimum listing for unpriced pubs", () => {
    const priced = { ...unpriced(), cheapestPrice: 7, priceSource: "Pub menu", priceObservedAt: "2026-11-08" };
    applySlimListingPrices([priced], [listing], listingNow);
    expect(priced).toMatchObject({ cheapestPrice: 7, priceSource: "Pub menu", priceObservedAt: "2026-11-08" });
    for (const rows of [[listing, { ...listing, priceGbp: 6.9 }], [{ ...listing, priceGbp: 6.9 }, listing]]) {
      const row = unpriced();
      applySlimListingPrices([row], rows, listingNow);
      expect(row).toMatchObject({ cheapestPrice: 6.45, priceSource: "Guinndex", priceObservedAt: "2026-11-07" });
    }
  });

  it("keeps the first equal-price row in the actual generated detail artifact", () => {
    // Two pint-prices listings of one pub state the same cheapest pint.
    const id = "venue-1dydno";
    const manifest = JSON.parse(readFileSync("data/generated/venue_detail_index.json", "utf8")) as { venues: Record<string, { offset: number; length: number }> };
    const entry = manifest.venues[id]!;
    const bytes = readFileSync("data/generated/venue_details.jsonl").subarray(entry.offset, entry.offset + entry.length);
    const artifact = JSON.parse(bytes.toString("utf8"));
    const live = artifact.rows.filter(isLivePriceRow);
    const minimum = Math.min(...live.map((row: { price_gbp: number }) => row.price_gbp));
    const tied = live.filter((row: { price_gbp: number }) => row.price_gbp === minimum);
    expect(tied.length).toBeGreaterThan(1);
    expect(tied[0].pub_url).not.toBe(tied[1].pub_url);
    const detail = venueFromDetailArtifact(artifact, id);
    expect(detail?.prices[0]).toMatchObject({ pint_name: tied[0].pint_name, pub_url: tied[0].pub_url, scraped_at_values: tied[0].scraped_at_values });
    expect(legacyCheapestPriceEvidence(live, minimum)).toMatchObject({ priceSource: "Pint Prices" });
    expect(buildSlimPriceEvidence(live, minimum).priceObservedAt).toBe(priceRowReadDay(tied[0]));
  });

  it("keeps the first minimum row's publisher and date when a tied row is newer", () => {
    const firstRead = new Date(PINT_DATASET_TEST_NOW - DAY_MS).toISOString();
    const laterRead = new Date(PINT_DATASET_TEST_NOW).toISOString();
    const rows = [
      { price_gbp: 5, pint_name: "Lager", pub_url: "https://first.example/menu", scraped_at_values: firstRead },
      { price_gbp: 5, pint_name: "Stout", pub_url: "https://later.example/menu", scraped_at_values: laterRead },
    ];
    expect(priceRowReadDay(rows[0])).not.toBe(priceRowReadDay(rows[1]));
    expect(buildSlimPriceEvidence(rows, 5)).toEqual({ priceSource: "first.example", priceObservedAt: priceRowReadDay(rows[0]) });
    expect(legacyCheapestPriceEvidence(rows, 5)).toMatchObject({
      cheapestPint: "Lager", priceSource: "first.example", priceObservedAt: firstRead,
    });
  });
  it.each([
    ["Half-pint lager", "half"],
    ["half_pint lager", "half"],
    ["Half–pint lager", "half"],
    ["2 halves of stout", "half"],
    ["1/2 lager", "half"],
    ["lager ½", "half"],
    ["Schooner of IPA", "other"],
    ["Third of stout", "other"],
    ["stout 2/3", "other"],
  ])("retains %s for display and refuses its figure as a pint", (pint_name, measure) => {
    expect(measureNamedInDrinkText(pint_name)).toBe(measure);
    const evidence = buildSlimPriceEvidence([
      { price_gbp: 3.4, pint_name, pub_url: "https://pub.example/menu", scraped_at_values: "2026-01-01" },
      { price_gbp: 3.4, pint_name: "Lager", measure: "pint", pub_url: "https://other.example/menu", scraped_at_values: "2026-01-02" },
    ], 3.4);
    expect(evidence).toEqual({ cheapestPint: pint_name, priceSource: "pub.example", priceObservedAt: "2026-01-01" });
    const slimRows = [
      { id: "half", cheapestPrice: 3.4, ...evidence },
      { id: "pint", cheapestPrice: 5, priceSource: "Pub menu", priceObservedAt: "2026-01-01" },
    ];
    expect(comparablePint(slimRows[0])).toBeNull();
    const pack = buildLastOrdersPacks({
      facts: { extractedAt: "2026-01-01", rows: [1, 2].map((n) => ({ osmId: `node/${n}`, openingHours: "24/7" })) },
      pubs: slimRows.map((row, i) => ({ osmId: `node/${i + 1}`, name: row.id, lat: 51.5, lng: -0.1,
        curatedRef: { source: "curated-london-slim", id: row.id } })),
      slimRows,
      closed: {},
    });
    expect(pack.hours.rows.map((row) => row[0])).toEqual(["half", "pint"]);
    expect(pack.prices.rows).toEqual({ pint: [5, "2026-01-01"] });
  });

  it.each(["BOTTLED BEER", "Lager can", "330ml Lager", "Lager 50 cl", "Lager 0.5l"])("preserves the existing refusal for %s", (pint_name) => {
    const evidence = buildSlimPriceEvidence([
      { price_gbp: 3.4, pint_name, pub_url: "https://pub.example/menu", scraped_at_values: "2026-01-01" },
    ], 3.4);
    expect(evidence.cheapestPint).toBe(pint_name);
    expect(comparablePint({ cheapestPrice: 3.4, ...evidence })).toBeNull();
  });

  it.each(["Lager", "Other Half Green Diamond", "Half Moon IPA", "Small Beer Lager", "Third Wheel Bitter", "Lager 568 ml"])("keeps the legacy pint price for %s", (pint_name) => {
    const evidence = buildSlimPriceEvidence([
      { price_gbp: 5, pint_name, pub_url: "https://pub.example/menu", scraped_at_values: "2026-01-01" },
    ], 5);
    expect(evidence).toEqual({ priceSource: "pub.example", priceObservedAt: "2026-01-01" });
    expect(comparablePint({ cheapestPrice: 5, ...evidence })).toBe(5);
  });
});
