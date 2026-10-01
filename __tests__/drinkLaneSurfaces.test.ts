import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import DrinkLanePicker from "@/components/map/DrinkLanePicker";
import VenueDrinkPrices from "@/components/map/VenueDrinkPrices";
import VenuePriceSubmit from "@/components/map/VenuePriceSubmit";
import type { CommunityPricesState } from "@/components/map/useCommunityPrices";
import type { CommunityPrice } from "@/lib/communityPrice";
import { MAP_DRINK_LANES } from "@/lib/drinkLanes";
import { CATEGORY_META, type DrinkCategory } from "@/lib/drinks";
import type { VenuePriceReadStatus } from "@/lib/mapExperienceLens";
import type { ListedCategoryPrice } from "@/lib/listedCategoryPrices";

const authState = vi.hoisted(() => ({
  current: { user: { id: "acct-1" }, loading: false } as Record<string, unknown>,
}));

vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => authState.current,
}));

const communityPrices = {
  byVenueId: new Map(),
  signalsByVenueId: new Map(),
  freshestByVenueId: new Map(),
  venuePriceStatus: new Map(),
  loadVenue: vi.fn(),
  submit: vi.fn(),
  submitVenueSignal: vi.fn(),
  submitting: false,
  reportPrice: vi.fn(),
  reportedIds: new Set<string>(),
} as unknown as CommunityPricesState;

function price(
  drinkCategory: DrinkCategory,
  priceGbp: number,
  submittedAt: number,
): CommunityPrice {
  return {
    id: `obs-${drinkCategory}`,
    venueId: "the-crown",
    drinkCategory,
    priceGbp,
    submittedAt,
    source: "community",
    corroborations: 2,
  };
}

const NOW = Date.parse("2026-08-10T19:00:00Z");

function renderVenuePrices({
  rows,
  activeLane,
  laneNoun,
  readStatus = "ready",
  canLog = true,
  listedPrices,
}: {
  rows: CommunityPrice[] | undefined;
  activeLane: DrinkCategory;
  laneNoun: string;
  readStatus?: VenuePriceReadStatus;
  canLog?: boolean;
  listedPrices?: ListedCategoryPrice[] | null;
}) {
  return renderToStaticMarkup(
    createElement(VenueDrinkPrices, {
      venueId: "the-crown",
      venueName: "The Crown",
      rows,
      activeLane,
      laneNoun,
      readStatus,
      communityPrices,
      onLogPrice: vi.fn(),
      canLog,
      listedPrices,
    }),
  );
}

describe("DrinkLanePicker", () => {
  it("puts every lane on screen at once rather than inside a menu", () => {
    const html = renderToStaticMarkup(
      createElement(DrinkLanePicker, { lane: "beer", onChange: vi.fn() }),
    );
    expect(html).not.toContain("<select");
    for (const lane of MAP_DRINK_LANES) {
      expect(html).toContain(`>${lane.label}</button>`);
    }
    expect(html).toContain("Pints");
  });

  it("does not offer Other as a map lane", () => {
    // Other stays submittable (a liqueur, a cider), but a pin reading
    // "£6 Other" over a pint glass would label a figure with no drink name.
    const html = renderToStaticMarkup(
      createElement(DrinkLanePicker, { lane: "beer", onChange: vi.fn() }),
    );
    expect(html).not.toContain(`>${CATEGORY_META.other.label}</button>`);
  });

  it("marks the lane the map is actually under", () => {
    const html = renderToStaticMarkup(
      createElement(DrinkLanePicker, { lane: "cocktail", onChange: vi.fn() }),
    );
    expect(html).toMatch(/aria-pressed="true"[^>]*>Cocktails</);
    expect(html).not.toMatch(/aria-pressed="true"[^>]*>Pints</);
  });

  it("keeps other servings and community reports visible without claiming they are comparable", () => {
    const html = renderToStaticMarkup(
      createElement(DrinkLanePicker, { lane: "cocktail", onChange: vi.fn() }),
    );
    expect(html).toContain("Other servings and community reports stay visible, unranked.");
    expect(html).not.toContain("confirmed cocktail prices");
    expect(html).not.toContain("colours pins");
  });

  it("never words a lane it could not read as a lane with no prices", () => {
    const html = renderToStaticMarkup(
      createElement(DrinkLanePicker, {
        lane: "cocktail",
        status: "degraded",
        onChange: vi.fn(),
      }),
    );
    expect(html).toContain("could not read the cocktail prices");
    const loading = renderToStaticMarkup(
      createElement(DrinkLanePicker, {
        lane: "cocktail",
        status: "loading",
        onChange: vi.fn(),
      }),
    );
    expect(loading).toContain("Checking cocktail prices");
  });

  it("lets the phone sheet chrome own the one heading", () => {
    const sheet = renderToStaticMarkup(
      createElement(DrinkLanePicker, {
        lane: "beer",
        variant: "sheet",
        onChange: vi.fn(),
      }),
    );
    expect(sheet).not.toContain("What are you drinking?");
    expect(sheet).toContain("Pints");
  });
});

describe("VenueDrinkPrices", () => {
  const wineQuote: ListedCategoryPrice = {
    source: "listed",
    category: "wine",
    drinkLabel: "Chardonnay",
    priceGbp: 5.5,
    servingSize: null,
    sourceUrl: "https://pub.example/menu",
    observedAt: "2026-09-20T10:00:00Z",
  };

  it("shows a listed wine quote with its source and unknown serving, without calling it community", () => {
    const html = renderVenuePrices({
      rows: [],
      activeLane: "wine",
      laneNoun: "wine",
      listedPrices: [wineQuote],
    });
    expect(html).toContain("Chardonnay");
    expect(html).toContain("Wine · Chardonnay");
    expect(html).toContain("£5.50");
    expect(html).toContain("Serving not recorded");
    expect(html).toContain("20 September 2026");
    expect(html).toContain('href="https://pub.example/menu"');
    expect(html).not.toContain("Logged by a PUBMAXXER");
    expect(html).not.toContain("No wine price logged by drinkers yet");
  });

  it("keeps a listed quote visible when the community read is degraded", () => {
    const html = renderVenuePrices({
      rows: [],
      activeLane: "wine",
      laneNoun: "wine",
      readStatus: "degraded",
      listedPrices: [wineQuote],
    });
    expect(html).toContain("£5.50");
    expect(html).toContain("Could not read drinker-logged prices just now.");
  });

  it("shows a stated serving and keeps listed-read failure separate from community prices", () => {
    const html = renderVenuePrices({
      rows: [price("wine", 6.2, NOW)],
      activeLane: "wine",
      laneNoun: "wine",
      listedPrices: null,
    });
    expect(html).toContain("£6.20");
    expect(html).toContain("Published menu prices unavailable just now.");
    const withServing = renderVenuePrices({
      rows: [],
      activeLane: "wine",
      laneNoun: "wine",
      listedPrices: [{ ...wineQuote, servingSize: "125ml" }],
    });
    expect(withServing).toContain("125ml");
    expect(withServing).not.toContain("Serving not recorded");
  });
  it("leads with the lane the reader is under, not the last drink logged", () => {
    const html = renderVenuePrices({
      rows: [price("coffee", 3.4, NOW), price("cocktail", 12, NOW - 5_000)],
      activeLane: "cocktail",
      laneNoun: "cocktail",
    });
    expect(html.indexOf("£12.00")).toBeLessThan(html.indexOf("£3.40"));
  });

  it("never merges two drinks into one figure", () => {
    // Each row prints its own tag beside its own figure, so a cocktail map
    // cannot make a coffee price read as the cocktail price.
    const html = renderVenuePrices({
      rows: [price("beer", 6.2, NOW), price("cocktail", 12, NOW - 5_000)],
      activeLane: "cocktail",
      laneNoun: "cocktail",
    });
    expect(html).toContain("£12.00");
    expect(html).toContain("£6.20");
    expect(html).toContain(CATEGORY_META.cocktail.label);
    expect(html).toContain(CATEGORY_META.beer.label);
    // One row per drink, and no combined or averaged figure anywhere.
    expect(html.match(/£12\.00/g)).toHaveLength(1);
    expect(html.match(/£6\.20/g)).toHaveLength(1);
  });

  it("says an empty lane is empty, and invites a price for that drink", () => {
    const html = renderVenuePrices({
      rows: [price("beer", 6.2, NOW)],
      activeLane: "cocktail",
      laneNoun: "cocktail",
    });
    expect(html).toContain("No cocktail price logged by drinkers yet.");
    expect(html).toContain("Log a cocktail price");
    // The pub's real beer row is still there: an empty lane hides nothing.
    expect(html).toContain("£6.20");
  });

  it("does not invite a price off the back of a read that failed", () => {
    const html = renderVenuePrices({
      rows: [],
      activeLane: "cocktail",
      laneNoun: "cocktail",
      readStatus: "degraded",
    });
    expect(html).toContain("We could not read this pub");
    expect(html).toContain("cocktail prices just now");
    expect(html).not.toContain("Log a cocktail price");
  });

  it("does not invite a price at a venue that takes none", () => {
    const html = renderVenuePrices({
      rows: [],
      activeLane: "cocktail",
      laneNoun: "cocktail",
      canLog: false,
    });
    expect(html).not.toContain("Log a cocktail price");
  });
});

describe("VenuePriceSubmit", () => {
  function renderComposer(laneCategory: DrinkCategory) {
    return renderToStaticMarkup(
      createElement(VenuePriceSubmit, {
        venueId: "the-crown",
        venueName: "The Crown",
        communityPrices,
        laneCategory,
      }),
    );
  }

  it("opens on the drink the map is under", () => {
    const html = renderComposer("cocktail");
    expect(html).toMatch(
      new RegExp(`aria-checked="true"[^>]*>${CATEGORY_META.cocktail.label}<`),
    );
  });

  it("offers a lane that is not on the shortcut row", () => {
    // A gin map used to open the composer on beer with no gin chip in sight.
    const html = renderComposer("gin");
    expect(html).toContain(`>${CATEGORY_META.gin.label}<`);
    expect(html).toMatch(
      new RegExp(`aria-checked="true"[^>]*>${CATEGORY_META.gin.label}<`),
    );
  });

  it("names the drink in the singular where a sentence needs it", () => {
    // The chips are menu-section names, so lowercasing one read out to a
    // screen reader as "price of a cocktails".
    expect(renderComposer("cocktail")).toContain(
      'aria-label="Price of a cocktail at The Crown, in pounds"',
    );
    expect(renderComposer("soft-drink")).toContain(
      'aria-label="Price of a soft drink at The Crown, in pounds"',
    );
  });

  it("still opens on beer where no lane is passed", () => {
    const html = renderToStaticMarkup(
      createElement(VenuePriceSubmit, {
        venueId: "the-crown",
        venueName: "The Crown",
        communityPrices,
      }),
    );
    expect(html).toMatch(
      new RegExp(`aria-checked="true"[^>]*>${CATEGORY_META.beer.label}<`),
    );
  });
});
