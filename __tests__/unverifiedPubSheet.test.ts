import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import UnverifiedPubSheet from "@/components/map/UnverifiedPubSheet";
import type { CommunityPricesState } from "@/components/map/useCommunityPrices";
import type { CommunityPrice } from "@/lib/communityPrice";
import type { MapExperienceLens } from "@/lib/mapExperienceLens";
import type { UkBasePub } from "@/lib/ukBasePubs";

const pub: UkBasePub = {
  id: "venue-uk-n123",
  name: "The Test Arms",
  address: "1 Test Street",
  lat: 53.8008,
  lng: -1.5491,
  curatedVenueId: "",
};

function state(rows: CommunityPrice[], known = true): CommunityPricesState {
  return {
    byVenueId: known ? new Map([[pub.id, rows]]) : new Map(),
    freshestByVenueId: new Map(),
    noAlcoholIndexStatus: "idle",
    provisionalBaseVenueIds: new Set(),
    loadProvisionalBaseVenues: () => {},
    loadVenue: () => {},
    loadNoAlcoholIndex: () => {},
    loadDrinkCategoryIndex: () => {},
    drinkCategoryIndexStatus: new Map(),
    submit: async () => ({ ok: true }),
    submitting: false,
    reportPrice: () => {},
    reportedIds: new Set<string>(),
  };
}

function renderSheet(
  rows: CommunityPrice[],
  experienceLens: MapExperienceLens = "all",
) {
  return renderToStaticMarkup(
    createElement(UnverifiedPubSheet, {
      pub,
      communityPrices: state(rows),
      experienceLens,
    }),
  );
}

// NOTE ON WHAT IS *NOT* TESTED HERE. The `key={pub.id}` that resets the price
// form when the selection moves straight from one base pub to another is
// deliberately NOT asserted in this file. Vitest runs in a node environment
// (vitest.config.ts) with no DOM, so the only thing reachable from here is the
// React element's key - a shape assertion that passes whether or not the form
// actually clears. That test cannot fail for the reason it claims to guard.
// The real A-to-B transition is driven through one mounted sheet in a real
// browser, in e2e/map-uk-base-layer.spec.ts.

describe("UnverifiedPubSheet", () => {
  it("never flashes no-price framing while a stored price reloads", () => {
    const stored: CommunityPrice = {
      venueId: pub.id,
      drinkCategory: "beer",
      priceGbp: 4.6,
      submittedAt: Date.now(),
      source: "community",
      corroborations: 1,
    };
    const frames = [
      renderToStaticMarkup(
        createElement(UnverifiedPubSheet, {
          pub,
          communityPrices: state([], false),
        }),
      ),
      renderToStaticMarkup(
        createElement(UnverifiedPubSheet, {
          pub,
          communityPrices: state([stored]),
        }),
      ),
    ];

    for (const html of frames) {
      expect(html).not.toContain("No price yet");
      expect(html).not.toContain("Nobody has logged");
    }
    expect(frames[0]).toContain("Checking community prices");
    expect(frames[1]).toContain("£4.60");
  });

  it("renders a stored dated community price without no-price framing", () => {
    const html = renderToStaticMarkup(
      createElement(UnverifiedPubSheet, {
        pub,
        communityPrices: state([
          {
            venueId: pub.id,
            drinkCategory: "beer",
            priceGbp: 4.6,
            submittedAt: Date.now(),
            source: "community",
            corroborations: 1,
          },
        ]),
      }),
    );

    expect(html).toContain("£4.60");
    expect(html).toContain("today · community");
    expect(html).toContain("Logged by a Pubmaxxer");
    expect(html).not.toContain("No price yet");
    expect(html).not.toContain("Nobody has logged");
  });

  it("shows only no-alcohol rows and an honest empty state in that lens", () => {
    const beer: CommunityPrice = {
      venueId: pub.id,
      drinkCategory: "beer",
      priceGbp: 5.8,
      submittedAt: Date.now(),
      source: "community",
      corroborations: 2,
    };
    const softDrink: CommunityPrice = {
      venueId: pub.id,
      drinkCategory: "soft-drink",
      priceGbp: 2.9,
      submittedAt: Date.now() - 1,
      source: "community",
      corroborations: 2,
    };

    const priced = renderSheet([beer, softDrink], "no-alcohol");
    expect(priced).toContain("£2.90");
    expect(priced).not.toContain("£5.80");

    const empty = renderSheet([beer], "no-alcohol");
    expect(empty).toContain("No soft-drink or alcohol-free price logged here yet");
    expect(empty).not.toContain("£5.80");
  });

  it("never shows a beer price in the food view", () => {
    const html = renderSheet(
      [
        {
          venueId: pub.id,
          drinkCategory: "beer",
          priceGbp: 5.8,
          submittedAt: Date.now(),
          source: "community",
          corroborations: 2,
        },
      ],
      "food",
    );

    expect(html).toContain("No sourced food price recorded here.");
    expect(html).not.toContain("£5.80");
  });

  it("names the base pin mark without promising the pin a colour", () => {
    const html = renderToStaticMarkup(
      createElement(UnverifiedPubSheet, {
        pub,
        communityPrices: state([
          {
            venueId: pub.id,
            drinkCategory: "beer",
            priceGbp: 4.6,
            submittedAt: Date.now(),
            source: "community",
            corroborations: 1,
          },
        ]),
      }),
    );

    // The mark is real and the reader can go and look at it, so the sheet says
    // so. The pin COLOUR is not: base features carry no band and no pin price
    // label, so no wording here may offer one for a second report.
    expect(html).toContain("Marked on the map as unconfirmed");
    expect(html).toContain("confirms the figure here");
    expect(html).not.toContain("moves the map");
    expect(html).not.toContain("colour");
    expect(html).not.toContain("On the map</span>");
  });

  it("shows be-the-first framing only after a confirmed empty response", () => {
    const html = renderToStaticMarkup(
      createElement(UnverifiedPubSheet, {
        pub,
        communityPrices: state([]),
      }),
    );

    expect(html).toContain("No price yet");
    expect(html).toContain("Nobody has logged");
  });
});
