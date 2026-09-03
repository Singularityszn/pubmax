import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import VenueMenuTab from "@/components/map/inspector/VenueMenuTab";
import { menuHubTiles } from "@/lib/menuHub";
import type { Drink } from "@/lib/drinks";
import { pintDropDrinksForMenu } from "@/lib/pintDropDrinks";
import type { PintDrop } from "@/lib/pintDropShared";
import type { Venue } from "@/lib/venues";

const OBSERVED = "2026-09-03T18:00:00.000Z";

function drop(overrides: Partial<PintDrop> = {}): PintDrop {
  return {
    id: "drop-1",
    venueId: "venue-test",
    handle: "@tester",
    drink: "Negroni",
    priceGbp: 9.5,
    passedDownNote: "",
    era: "",
    provenance: "contributor",
    status: "visible",
    visibility: "public",
    createdAt: OBSERVED,
    ...overrides,
  };
}

function curatedDrink(overrides: Partial<Drink> = {}): Drink {
  return {
    id: "curated-1",
    category: "beer",
    name: "Guinness",
    priceGbp: 5.5,
    provenance: {
      source: "app-dataset",
      licence: "first-party",
      observedAt: OBSERVED,
      lane: "dataset",
    },
    ...overrides,
  };
}

function venue(): Venue {
  return {
    id: "venue-test",
    name: "The Test Arms",
    address: "1 Test Street",
    latitude: 51.5,
    longitude: -0.12,
    primaryBorough: "Camden",
    visibleBoroughs: ["Camden"],
    prices: [],
    cheapestPrice: null,
    cheapestPint: "",
    averagePrice: null,
    hasStory: false,
    latestContributorPrice: null,
    latestContributorAt: null,
    amenities: {
      food: false,
      cocktails: false,
      beerGarden: false,
      liveSports: false,
      liveMusic: false,
      pubQuiz: false,
      darts: false,
      pool: false,
      happyHour: false,
      karaoke: false,
      nonAlcoholic: false,
    },
    website: "",
    bookingLink: "",
    imageUrl: "",
    description: "",
    dataQualityNotes: [],
    sourceDatasets: [],
    curation: {},
  };
}

describe("pintDropDrinksForMenu", () => {
  it("projects a priced drop into a stable, parser-classified Drink with Pint Drop provenance", () => {
    const drops = [drop({ id: "drop-negroni", drink: "  Negroni  " })];

    const first = pintDropDrinksForMenu(drops, []);
    const second = pintDropDrinksForMenu(drops, []);

    expect(first).toEqual(second);
    expect(first).toEqual([
      expect.objectContaining({
        id: "pint-drop-drop-negroni",
        category: "gin",
        name: "Negroni",
        priceGbp: 9.5,
        provenance: {
          source: "Pint Drop",
          licence: "community contribution",
          observedAt: OBSERVED,
        },
      }),
    ]);
  });

  it("keeps hidden and friends-only rows out of a signed-out menu and drops unknown or invalid prices", () => {
    const projected = pintDropDrinksForMenu(
      [
        drop({ id: "public", drink: "Cola", priceGbp: 2.5 }),
        drop({ id: "anonymous", drink: "Lager", priceGbp: 5, visibility: "anonymous" }),
        drop({ id: "friends", drink: "Gin", priceGbp: 7, visibility: "friends" }),
        drop({ id: "legacy", drink: "Whisky", priceGbp: 8, visibility: "legacy" }),
        drop({ id: "hidden", drink: "Rum", priceGbp: 8, status: "hidden" }),
        drop({ id: "note-only", drink: "Coffee", priceGbp: null }),
        drop({ id: "zero", drink: "Lager", priceGbp: 0 }),
        drop({ id: "negative", drink: "Lager", priceGbp: -1 }),
        drop({ id: "nan", drink: "Beer", priceGbp: Number.NaN }),
        drop({ id: "infinite", drink: "Beer", priceGbp: Number.POSITIVE_INFINITY }),
        drop({ id: "unknown", drink: "The usual", priceGbp: 6 }),
      ],
      [],
    );

    expect(projected.map((drink) => drink.id)).toEqual([
      "pint-drop-public",
      "pint-drop-anonymous",
    ]);
    expect(projected.every((drink) => drink.priceGbp !== 0)).toBe(true);
    expect(projected.every((drink) => Number.isFinite(drink.priceGbp))).toBe(true);
  });

  it("does not duplicate a curated name-plus-price and still creates the existing category tile", () => {
    const curated = [curatedDrink()];
    const additions = pintDropDrinksForMenu(
      [
        drop({ id: "same-curated", drink: " guinness ", priceGbp: 5.5 }),
        drop({ id: "new-gin", drink: "Gin", priceGbp: 7 }),
      ],
      curated,
    );
    const tiles = menuHubTiles(venue(), [...curated, ...additions]);

    expect(additions.map((drink) => drink.name)).toEqual(["Gin"]);
    expect(tiles).toContainEqual(
      expect.objectContaining({
        id: "cat-gin",
        kind: "drink-category",
        category: "gin",
        count: 1,
      }),
    );
  });

  it("uses already-loaded public drops to replace the venue Drinks empty state", () => {
    const html = renderToStaticMarkup(
      createElement(VenueMenuTab, {
        venue: venue(),
        tab: "menu",
        pintDrops: [
          drop({
            id: "hatton-lager",
            venueId: "venue-test",
            drink: "Lager",
            priceGbp: 4.5,
          }),
        ],
        onAddDrink: vi.fn(),
      }),
    );

    expect(html).toContain("1 on record");
    expect(html).not.toContain("We don’t have this pub’s drinks yet.");
  });
});
