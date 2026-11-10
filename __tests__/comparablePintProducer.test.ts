import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { comparablePint } from "@/lib/comparablePint.mjs";
import { measureNamedInDrinkText } from "@/lib/drinkMeasure";
import { buildSlimPriceEvidence, bundleSlimHints } from "@/scripts/build_slim_index.mjs";
import { buildLastOrdersPacks } from "@/scripts/build_last_orders_pack.mjs";
import { venueFromDetailArtifact } from "@/lib/venueDetailIndex";
import { legacyCheapestPriceEvidence } from "@/lib/legacyPriceEvidence.mjs";
import { isLivePriceRow } from "@/lib/priceRowEligibility.mjs";
import { priceRowReadDay } from "@/lib/priceReadDay.mjs";
import { PINT_DATASET_TEST_NOW } from "@/__tests__/helpers/pintDatasetClock";
import { DAY_MS } from "@/lib/dayMs";

describe("selected serving evidence in the published price packs", () => {
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


describe("slim bundle price availability", () => {
  it("retains a recorded beer lane even without a slim minimum", () => {
    const hints = bundleSlimHints([
      { venueId: "kings-head", category: "beer", standing: "listed", priceGbp: 6.45 },
      { venueId: "bare", category: "beer", standing: "estimate", priceGbp: 4.6 },
      { venueId: "wine-only", category: "wine", standing: "listed", priceGbp: 7 },
    ]);
    expect(hints.recordedPintVenueIds).toEqual(new Set(["kings-head"]));
    expect(bundleSlimHints([]).recordedPintVenueIds).toEqual(new Set());
    expect(bundleSlimHints(null).recordedPintVenueIds).toBeNull();
    const published = JSON.parse(readFileSync("public/data/uk_prices/rows.json", "utf8"));
    expect(bundleSlimHints(published).recordedPintVenueIds?.has("venue-10x17k9")).toBe(true);
  });
});
