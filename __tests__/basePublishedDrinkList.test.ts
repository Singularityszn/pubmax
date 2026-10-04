import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import MapVenueList from "@/components/map/MapVenueList";
import { readListedDrinkIndex, discoveryDrinkLensPrices } from "@/lib/mapExperienceLens";
import { buildUkBasePubListModel } from "@/lib/mapVenueList";
import { parseUkBaseShard } from "@/lib/ukBasePubs";
import { ukPriceBundleCategoryIndex } from "@/lib/ukPriceBundle.server";

const venueId = "venue-uk-n1116251530";
const shard = JSON.parse(readFileSync("public/data/uk_base/packs/4dbe610a48791f78/51.500_-0.125.json", "utf8"));
const pub = parseUkBaseShard(shard).find((candidate) => candidate.id === venueId);
const now = Date.parse("2026-10-04T12:00:00Z");

// Public provider-to-list proof. PubMap's caller wiring is covered separately
// by map-base-listed-price-list.spec.ts on a matching production build.
describe("published drinks in the streamed pub list", () => {
  it("renders the real base pub's owned quote with source, day and unknown serving", async () => {
    expect(pub).toBeDefined();
    const index = await ukPriceBundleCategoryIndex("gin", now);
    expect(index.degraded).not.toBe(true);
    expect(index.truncated).toBe(false);
    const prices = discoveryDrinkLensPrices(new Map(), "gin", readListedDrinkIndex(index.prices, "gin"), now);
    const model = buildUkBasePubListModel([pub!], [-0.12478, 51.5303], undefined,
      prices, "cheapest", null, null);
    expect(model.rows[0].sortPrice).toBeNull();
    const html = renderToStaticMarkup(createElement(MapVenueList, {
      model: { rows: [], total: 0, shown: 0, truncated: false, coverageNote: null },
      ukBaseModel: model, ukBaseStatus: "ready", cityName: "London", open: true, loaded: true,
      onOpenChange: () => {}, onSelectVenue: () => {}, onSelectUkBasePub: () => {},
      onPrefetchVenue: () => {}, sortMode: "cheapest", onSortModeChange: () => {},
      drinkCategory: "gin", servingGroup: null,
    }));
    expect(html).toContain("Gin · £10.00");
    expect(html).toContain("Serving not recorded · www.thebetjemanarms.co.uk · 21 Sept 2026 · Unranked");
    expect(html).not.toContain("Other pub · no listed price");
    expect(html).not.toContain("25ml");
    expect(html).toMatch(/disabled=""[^>]*>Cheapest/);
  });

  it("keeps the main pint-default row unpriced when no selected quote is supplied", () => {
    expect(pub).toBeDefined();
    const model = buildUkBasePubListModel([pub!], [-0.12478, 51.5303]);
    expect(model.rows[0]).toMatchObject({ id: venueId, priceLabel: "Other pub · no listed price" });
    expect(model.rows[0].lensPrice).toBeUndefined();
    expect(model.rows[0].sortPrice).toBeUndefined();
  });
});
