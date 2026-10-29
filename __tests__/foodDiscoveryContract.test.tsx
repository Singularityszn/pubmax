// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import TonightArcChips from "@/components/map/TonightArcChips";
import { defined } from "@/__tests__/helpers/defined";
import {
  filterVenuesForExperienceLens,
  experienceLensSummary,
  lensPriceForVenue,
  type MapLensPrice,
} from "@/lib/mapExperienceLens";
import {
  defaultVenueKindVisibility,
  hiddenVenueKindCount,
  offeredVenueKinds,
  showAllVenueKinds,
} from "@/lib/venueKindFilters";
import { BASE_TABS, resolveVenueTab, tabsForVenue } from "@/lib/venueInspectorTabs";
import { groupVenuePrices, venueAmenityStatus, type Venue, type VenuePrice } from "@/lib/venues";

// Match the real Eagle source rows so the regression includes its stable map ID.
function eagle(): Venue {
  const dataset = JSON.parse(readFileSync(
    join(process.cwd(), "public/data/pint_prices_app_dataset.json"), "utf8",
  )) as VenuePrice[];
  const rows = dataset.filter((row) =>
    row.pub_name === "The Eagle" && row.address === "215 Askew Rd, London W12 9AZ, UK",
  );
  return { ...defined(groupVenuePrices(rows)[0]), kind: "pub" };
}

function foodHint(venue: Venue): Venue {
  return {
    ...venue,
    filterHints: {
      searchText: "The Eagle 215 Askew Road",
      amenities: {
        food: true,
        cocktails: false,
        beerGarden: false,
        liveSports: false,
        nonAlcoholic: false,
      },
      curation: { nearWater: false, hasStory: false },
      canonical: true,
    },
  };
}

const noAlcoholPrices = new Map<string, MapLensPrice>();

describe("food discovery for pubs with stated food service", () => {
  it("includes the known-food Eagle through the food experience lens", () => {
    const venue = eagle();
    expect(venue.id).toBe("venue-1hz0avt");
    expect(venue.amenities.food).toBe(true);
    expect(filterVenuesForExperienceLens([venue], "food", noAlcoholPrices))
      .toEqual([venue]);
  });

  it("includes an affirmative slim food hint before detail arrives", () => {
    const known = eagle();
    const slim = foodHint({
      ...known,
      prices: [],
      amenities: { ...known.amenities, food: false },
      amenityStatus: undefined,
    });
    expect(filterVenuesForExperienceLens([slim], "food", noAlcoholPrices))
      .toEqual([slim]);
  });

  it("includes a bar with stated food service", () => {
    const venue = { ...eagle(), kind: "bar" as const };
    expect(filterVenuesForExperienceLens([venue], "food", noAlcoholPrices))
      .toEqual([venue]);
  });

  it.each(["pub", "bar", "food", "restaurant"] as const)(
    "excludes explicit known-false food for %s even when stale hints and booleans say yes",
    (kind) => {
      const known = eagle();
      const denied = foodHint({
        ...known,
        kind,
        amenityStatus: { ...venueAmenityStatus(known), food: "known-false" },
      });
      expect(denied.amenities.food).toBe(true);
      expect(denied.filterHints?.amenities.food).toBe(true);
      expect(filterVenuesForExperienceLens([denied], "food", noAlcoholPrices))
        .toEqual([]);
    },
  );

  it("uses affirmative detail status before a stale false boolean", () => {
    const known = eagle();
    const confirmed = {
      ...known,
      amenities: { ...known.amenities, food: false },
      amenityStatus: { ...venueAmenityStatus(known), food: "known-true" as const },
    };
    expect(filterVenuesForExperienceLens([confirmed], "food", noAlcoholPrices))
      .toEqual([confirmed]);
  });

  it("keeps absent food evidence unknown and excludes it", () => {
    const known = eagle();
    const unknown = {
      ...known,
      prices: [],
      amenities: { ...known.amenities, food: false },
      amenityStatus: { ...venueAmenityStatus(known), food: "unknown" as const },
      filterHints: undefined,
    };
    expect(filterVenuesForExperienceLens([unknown], "food", noAlcoholPrices))
      .toEqual([]);
  });

  it("honours a stated no in source rows over stale affirmative booleans and hints", () => {
    const known = eagle();
    const denied = foodHint({
      ...known,
      prices: known.prices.map((row) => ({ ...row, food: "No" })),
    });
    expect(venueAmenityStatus(denied).food).toBe("known-false");
    expect(filterVenuesForExperienceLens([denied], "food", noAlcoholPrices))
      .toEqual([]);
  });

  it("does not admit a food pub into no-alcohol view without separate drink evidence", () => {
    const known = eagle();
    const foodOnly = foodHint({
      ...known,
      amenities: { ...known.amenities, food: true, nonAlcoholic: false },
    });
    expect(filterVenuesForExperienceLens([foodOnly], "no-alcohol", noAlcoholPrices))
      .toEqual([]);
  });

  it("does not present a food pub's pint price as a dish anchor", () => {
    const known = eagle();
    const pintPriced = { ...known, cheapestPrice: 5.95 };
    expect(lensPriceForVenue(pintPriced, "food", noAlcoholPrices)).toBeNull();
  });
});

describe("food discovery controls", () => {
  it("offers every curated type that the food view can admit", () => {
    expect(offeredVenueKinds("food")).toEqual(["pub", "bar", "food", "restaurant"]);
    const off = { pub: false, bar: false, food: false, restaurant: false };
    expect(hiddenVenueKindCount(off, "food")).toBe(4);
    expect(showAllVenueKinds(off, "food")).toEqual(defaultVenueKindVisibility());
  });

  it("renders pub and bar choices that agree with the food view's offered kinds", () => {
    const container = document.createElement("div");
    container.innerHTML = renderToStaticMarkup(createElement(TonightArcChips, {
      visibility: defaultVenueKindVisibility(),
      experienceLens: "food",
      onChange: () => undefined,
    }));
    const group = container.querySelector('[role="group"][aria-label="Venue types"]');
    if (group === null) throw new Error("Expected the venue types group to render");
    const labels = [...group.querySelectorAll("button")].map((button) => {
      const visible = button.cloneNode(true) as HTMLElement;
      visible.querySelectorAll('[aria-hidden="true"]').forEach((node) => node.remove());
      return visible.textContent?.trim();
    });
    expect(labels).toEqual(["Pubs", "Bars", "Late food", "Restaurants"]);
    expect(labels).toHaveLength(offeredVenueKinds("food").length);
  });

  it("names the shared food and drink tab Menu without changing its route key", () => {
    expect(BASE_TABS.find((tab) => tab.key === "menu")).toEqual({
      key: "menu", label: "Menu", shortLabel: "Menu",
    });
    expect(resolveVenueTab("menu", "pub")).toBe("menu");
    expect(tabsForVenue("pub")).toHaveLength(5);
  });

  it("points to venue menus without claiming the map's absent anchors mean absent dish prices", () => {
    expect(experienceLensSummary("food", 0, 0, "ready"))
      .toBe("Food venues shown. Open Menu for dish prices we have.");
  });
});
