import { describe, expect, it } from "vitest";

import { comparablePint } from "@/lib/comparablePint.mjs";
import { measureNamedInDrinkText } from "@/lib/drinkMeasure";
import { buildSlimPriceEvidence, selectSlimPriceRow } from "@/scripts/build_slim_index.mjs";
import { buildLastOrdersPacks } from "@/scripts/build_last_orders_pack.mjs";

describe("selected serving evidence in the published price packs", () => {
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
    const evidence = buildSlimPriceEvidence(selectSlimPriceRow([
      { price_gbp: 3.4, pint_name, pub_url: "https://pub.example/menu", scraped_at_values: "2026-01-01" },
      { price_gbp: 3.4, pint_name: "Lager", measure: "pint", pub_url: "https://other.example/menu", scraped_at_values: "2026-01-02" },
    ]));
    expect(evidence).toEqual({ cheapestPint: pint_name, priceSource: "pub.example", priceSourceUrl: "https://pub.example/menu", priceObservedAt: "2026-01-01" });
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
    const evidence = buildSlimPriceEvidence(selectSlimPriceRow([
      { price_gbp: 3.4, pint_name, pub_url: "https://pub.example/menu", scraped_at_values: "2026-01-01" },
    ]));
    expect(evidence.cheapestPint).toBe(pint_name);
    expect(comparablePint({ cheapestPrice: 3.4, ...evidence })).toBeNull();
  });

  it.each(["Lager", "Other Half Green Diamond", "Half Moon IPA", "Small Beer Lager", "Third Wheel Bitter", "Lager 568 ml"])("keeps the legacy pint price for %s", (pint_name) => {
    const evidence = buildSlimPriceEvidence(selectSlimPriceRow([
      { price_gbp: 5, pint_name, pub_url: "https://pub.example/menu", scraped_at_values: "2026-01-01" },
    ]));
    expect(evidence).toEqual({ cheapestPint: pint_name, priceSource: "pub.example", priceSourceUrl: "https://pub.example/menu", priceObservedAt: "2026-01-01" });
    expect(comparablePint({ cheapestPrice: 5, ...evidence })).toBe(5);
  });
});
