import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import DrinkLanePicker from "@/components/map/DrinkLanePicker";
import MapVenueList from "@/components/map/MapVenueList";
import type { MapVenueListModel, UkBasePubListModel } from "@/lib/mapVenueList";

const emptyBase: UkBasePubListModel = {
  rows: [],
  total: 0,
  shown: 0,
  truncated: false,
};

describe("MapVenueList", () => {
  it("announces rendered base pubs as a distinct group without a listed price", () => {
    const curated: MapVenueListModel = {
      rows: [
        {
          id: "venue-curated",
          name: "Curated Arms",
          typeLabel: "Pub",
          priceLabel: "£4.50",
          anchor: null,
        },
      ],
      total: 1,
      shown: 1,
      truncated: false,
      coverageNote: null,
    };
    const base: UkBasePubListModel = {
      rows: [
        {
          id: "venue-uk-n123",
          name: "Base Arms",
          priceLabel: "Other pub · no listed price",
          pub: {
            id: "venue-uk-n123",
            name: "Base Arms",
            address: "",
            lat: 53.8,
            lng: -1.55,
            curatedVenueId: "",
            kind: "pub",
          },
        },
      ],
      total: 1,
      shown: 1,
      truncated: false,
    };

    const html = renderToStaticMarkup(
      createElement(MapVenueList, {
        model: curated,
        ukBaseModel: base,
        cityName: "UK",
        open: true,
        onOpenChange: () => {},
        loaded: true,
        onSelectVenue: () => {},
        onSelectUkBasePub: () => {},
        onPrefetchVenue: () => {},
      }),
    );

    expect(html).toContain('aria-label="Listed pubs and venues"');
    expect(html).toContain('aria-label="Other pubs and bars with no listed price"');
    expect(html).toContain("Base Arms");
    expect(html).toContain("Other pub · no listed price");
  });

  it("offers Nearest and Cheapest sort chips when the list has venues", () => {
    const curated: MapVenueListModel = {
      rows: [
        {
          id: "venue-curated",
          name: "Curated Arms",
          typeLabel: "Pub",
          priceLabel: "£4.50",
          anchor: null,
          sortPrice: 4.5,
        },
      ],
      total: 1,
      shown: 1,
      truncated: false,
      coverageNote: null,
    };

    const html = renderToStaticMarkup(
      createElement(MapVenueList, {
        model: curated,
        ukBaseModel: emptyBase,
        cityName: "London",
        open: true,
        onOpenChange: () => {},
        loaded: true,
        onSelectVenue: () => {},
        onSelectUkBasePub: () => {},
        onPrefetchVenue: () => {},
        sortMode: "cheapest",
        onSortModeChange: () => {},
      }),
    );

    expect(html).toContain('aria-label="Sort venues on the map"');
    expect(html).toContain("Nearest");
    expect(html).toContain("Cheapest");
    expect(html).toContain('aria-pressed="true"');
    const cheapest = html.match(/<button[^>]*>Cheapest<\/button>/)?.[0];
    expect(cheapest).toBeDefined();
    expect(cheapest).toContain('aria-pressed="true"');
    expect(cheapest).not.toContain("disabled");
  });

  it.each([null, "35ml"])("shows nearest order and disables Cheapest without comparable quotes for serving %s", (servingGroup) => {
    const curated: MapVenueListModel = {
      rows: [{ id: "venue-far", name: "Far Arms", typeLabel: "Pub",
        priceLabel: "£4.00", anchor: null, distanceKm: 0.8, sortPrice: null,
        lensPrice: { venueId: "venue-far", categoryLabel: "Gin", priceGbp: 4, source: "listed", category: "gin", drinkLabel: "Named gin",
          servingSize: "50ml", sourceUrl: "https://pub.example/menu", observedAt: "2026-09-24T12:00:00.000Z" } }],
      total: 2, shown: 1, truncated: true, coverageNote: null,
    };
    const base: UkBasePubListModel = {
      rows: [{ id: "venue-uk-near", name: "Near Arms", priceLabel: "Other pub · no listed price",
        distanceKm: 0.1, sortPrice: null,
        pub: { id: "venue-uk-near", name: "Near Arms", address: "", lat: 51.5, lng: -0.1,
          curatedVenueId: "", kind: "pub" } }],
      total: 1, shown: 1, truncated: false,
    };
    const html = renderToStaticMarkup(createElement(MapVenueList, {
      model: curated, ukBaseModel: base, cityName: "London", open: true,
      onOpenChange: () => {}, loaded: true, onSelectVenue: () => {},
      onSelectUkBasePub: () => {}, onPrefetchVenue: () => {},
      sortMode: "cheapest", onSortModeChange: () => {}, drinkCategory: "gin", servingGroup,
    }));

    const cheapest = html.match(/<button[^>]*>Cheapest<\/button>/)?.[0];
    const nearest = html.match(/<button[^>]*>Nearest<\/button>/)?.[0];
    expect(cheapest).toBeDefined();
    expect(cheapest).toContain('disabled=""');
    expect(cheapest).toContain('aria-pressed="false"');
    expect(nearest).toContain('aria-pressed="true"');
    expect(html).toContain("Nearest 2 of 3");
    expect(html).not.toContain("Cheapest 2 of 3");
    expect(html).toContain("Near Arms");
    expect(html).toContain("Far Arms");
    expect(html.indexOf("Near Arms")).toBeLessThan(html.indexOf("Far Arms"));
    expect(html).toMatch(/Named gin · 50ml · pub\.example · 24 Sept? 2026 · Unranked/);
  });

  it("keeps Cheapest available when one selected-serving quote can rank beside unranked offers", () => {
    const curated: MapVenueListModel = {
      rows: [{ id: "venue-near", name: "Near Unranked", typeLabel: "Pub",
        priceLabel: "£3.00", anchor: null, distanceKm: 0.1, sortPrice: null },
        { id: "venue-ranked", name: "Ranked Arms", typeLabel: "Pub", priceLabel: "£4.20",
          anchor: null, distanceKm: 0.8, sortPrice: 4.2,
          lensPrice: { venueId: "venue-ranked", categoryLabel: "Gin", priceGbp: 4.2, source: "listed", category: "gin", drinkLabel: "Named gin",
            servingSize: "25ml", sourceUrl: "https://pub.example/menu", observedAt: "2026-09-24T12:00:00.000Z" } }],
      total: 3, shown: 2, truncated: true, coverageNote: null,
    };
    const html = renderToStaticMarkup(createElement(MapVenueList, {
      model: curated, ukBaseModel: emptyBase, cityName: "London", open: true,
      onOpenChange: () => {}, loaded: true, onSelectVenue: () => {},
      onSelectUkBasePub: () => {}, onPrefetchVenue: () => {},
      sortMode: "cheapest", onSortModeChange: () => {}, drinkCategory: "gin", servingGroup: "25ml",
    }));

    const cheapest = html.match(/<button[^>]*>Cheapest<\/button>/)?.[0];
    const nearest = html.match(/<button[^>]*>Nearest<\/button>/)?.[0];
    expect(cheapest).toBeDefined();
    expect(cheapest).not.toContain("disabled");
    expect(cheapest).toContain('aria-pressed="true"');
    expect(nearest).toContain('aria-pressed="false"');
    expect(html).toContain("Cheapest 2 of 3");
    expect(html).toContain("Ranked Arms");
    expect(html).toContain("Near Unranked");
    expect(html.indexOf("Ranked Arms")).toBeLessThan(html.indexOf("Near Unranked"));
    expect(html).toMatch(/Named gin · 25ml · pub\.example · 24 Sept? 2026/);
  });

  it("keeps an empty list explicit and omits the sort chips", () => {
    const curated: MapVenueListModel = {
      rows: [],
      total: 0,
      shown: 0,
      truncated: false,
      coverageNote: null,
    };

    const html = renderToStaticMarkup(
      createElement(MapVenueList, {
        model: curated,
        ukBaseModel: emptyBase,
        cityName: "London",
        open: true,
        onOpenChange: () => {},
        loaded: true,
        onSelectVenue: () => {},
        onSelectUkBasePub: () => {},
        onPrefetchVenue: () => {},
        sortMode: "nearest",
        onSortModeChange: () => {},
      }),
    );

    expect(html).toContain("Nothing matches");
    expect(html).toContain(
      "Nothing in view fits that, which takes some doing round here",
    );
    expect(html).not.toContain('aria-label="Sort venues on the map"');
  });

  it("does not claim an empty view when unlisted pubs could not load", () => {
    const curated: MapVenueListModel = {
      rows: [],
      total: 0,
      shown: 0,
      truncated: false,
      coverageNote: null,
    };

    const html = renderToStaticMarkup(
      createElement(MapVenueList, {
        model: curated,
        ukBaseModel: emptyBase,
        ukBaseStatus: "unavailable",
        cityName: "London",
        open: true,
        onOpenChange: () => {},
        loaded: true,
        onSelectVenue: () => {},
        onSelectUkBasePub: () => {},
        onPrefetchVenue: () => {},
      }),
    );

    expect(html).toContain("Unlisted pubs could not load");
    expect(html).not.toContain("Nothing matches");
    expect(html).not.toContain("Nothing in view fits that");
    expect(html.match(/role="status"/g)).toHaveLength(1);
  });

  it("keeps an empty list pending while unlisted pubs are still loading", () => {
    const curated: MapVenueListModel = {
      rows: [],
      total: 0,
      shown: 0,
      truncated: false,
      coverageNote: null,
    };

    const html = renderToStaticMarkup(
      createElement(MapVenueList, {
        model: curated,
        ukBaseModel: emptyBase,
        ukBaseStatus: "loading",
        cityName: "London",
        open: true,
        onOpenChange: () => {},
        loaded: true,
        onSelectVenue: () => {},
        onSelectUkBasePub: () => {},
        onPrefetchVenue: () => {},
      }),
    );

    expect(html).toContain("Counting them up…");
    expect(html).not.toContain("Nothing matches");
    expect(html).not.toContain("Nothing in view fits that");
    expect(html.match(/role="status"/g)).toHaveLength(1);
  });

  it("discloses incomplete unlisted-pub coverage beside curated results", () => {
    const curated: MapVenueListModel = {
      rows: [
        {
          id: "venue-curated",
          name: "Curated Arms",
          typeLabel: "Pub",
          priceLabel: "£4.50",
          anchor: null,
        },
      ],
      total: 1,
      shown: 1,
      truncated: false,
      coverageNote: null,
    };

    const html = renderToStaticMarkup(
      createElement(MapVenueList, {
        model: curated,
        ukBaseModel: emptyBase,
        ukBaseStatus: "unavailable",
        cityName: "London",
        open: true,
        onOpenChange: () => {},
        loaded: true,
        onSelectVenue: () => {},
        onSelectUkBasePub: () => {},
        onPrefetchVenue: () => {},
      }),
    );

    expect(html).toContain("Some unlisted pubs could not load");
    expect(html).toContain("Curated Arms");
  });
});


it("offers source-stated serving choices and an explicit unranked view", () => {
  const html = renderToStaticMarkup(createElement(DrinkLanePicker, {
    lane: "gin", status: "ready", onChange: () => {},
    servingGroups: ["25ml", "50ml"], servingGroup: "25ml", onServingGroupChange: () => {},
  }));
  expect(html).toContain('aria-label="Serving size for price comparison"');
  expect(html).toContain("25ml");
  expect(html).toContain("50ml");
  expect(html).toContain("Choose a serving size to compare menu prices.");
  expect(html).toContain("Other servings and community reports stay visible, unranked.");
  expect(html.match(/compare menu prices/g)).toHaveLength(1);
  expect(html).not.toContain("35ml");
});
