import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import UnverifiedPubSheet, { HarvestOverlayFields } from "@/components/map/UnverifiedPubSheet";
import type { CommunityPricesState } from "@/components/map/useCommunityPrices";
import type { CommunityPrice } from "@/lib/communityPrice";
import type { ListedCategoryPrice } from "@/lib/listedCategoryPrices";
import type {
  MapExperienceLens,
  VenuePriceReadStatus,
} from "@/lib/mapExperienceLens";
import type { UkBasePub } from "@/lib/ukBasePubs";

vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => ({
    user: { id: "signed-in-drinker" },
    handle: "night_owl",
    identityResolved: true,
    loading: false,
    configured: true,
  }),
}));

const pub: UkBasePub = {
  id: "venue-uk-n123",
  name: "The Test Arms",
  address: "1 Test Street",
  lat: 53.8008,
  lng: -1.5491,
  curatedVenueId: "",
  kind: "pub",
};

function state(
  rows: CommunityPrice[],
  known = true,
  readStatus: VenuePriceReadStatus = known ? "ready" : "loading",
): CommunityPricesState {
  return {
    byVenueId: known ? new Map([[pub.id, rows]]) : new Map(),
    signalsByVenueId: new Map(),
    freshestByVenueId: new Map(),
    noAlcoholIndexStatus: "idle",
    listedNoAlcoholPrices: [],
    provisionalBaseVenueIds: new Set(),
    loadProvisionalBaseVenues: () => {},
    loadVenue: () => {},
    venuePriceStatus: new Map([[pub.id, readStatus]]),
    loadNoAlcoholIndex: () => {},
    loadDrinkCategoryIndex: () => {},
    drinkCategoryIndexStatus: new Map(),
    listedDrinkPrices: new Map(),
    listedPricesByVenueId: known ? new Map([[pub.id, []]]) : new Map(),
    submit: async () => ({ ok: true, attribution: { status: "anonymous" }, price: null, pintTrust: null, confirmationOutcome: null }),
    submitVenueSignal: async () => ({ ok: true }),
    submitting: false,
    reportPrice: () => {},
    reportedIds: new Set<string>(),
  };
}

function renderSheet(
  rows: CommunityPrice[],
  experienceLens: MapExperienceLens = "all",
  readStatus: VenuePriceReadStatus = "ready",
  drinkLensCategory: CommunityPrice["drinkCategory"] | null = null,
) {
  return renderToStaticMarkup(
    createElement(UnverifiedPubSheet, {
      pub,
      communityPrices: state(rows, true, readStatus),
      experienceLens,
      drinkLensCategory,
    }),
  );
}

// NOTE ON WHAT IS *NOT* TESTED HERE. The `key={pub.id}` that resets the price
// form when the selection moves straight from one base pub to another is
// deliberately NOT asserted in this file. Vitest runs in a node environment
// (vitest.config.mts) with no DOM, so the only thing reachable from here is the
// React element's key - a shape assertion that passes whether or not the form
// actually clears. That test cannot fail for the reason it claims to guard.
// The real A-to-B transition is driven through one mounted sheet in a real
// browser, in e2e/map-uk-base-layer.spec.ts.

describe("UnverifiedPubSheet", () => {
  it("holds a signed-in base-pub form while its price mission loads", () => {
    const html = renderSheet([]);

    expect(html).toContain("Checking...");
    expect(html).not.toContain(">Log it<");
    expect(html).not.toContain("moves the map");
    expect(html).not.toContain("colour");
  });

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
    expect(html).toContain("Logged by a PUBMAXXER");
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
    expect(empty).toContain("No alcohol-free or soft drink price logged here yet");
    expect(empty).not.toContain("£5.80");
  });

  it("shows only the drink-lens category and names coffee empties honestly", () => {
    const beer: CommunityPrice = {
      venueId: pub.id,
      drinkCategory: "beer",
      priceGbp: 5.8,
      submittedAt: Date.now(),
      source: "community",
      corroborations: 2,
    };
    const coffee: CommunityPrice = {
      venueId: pub.id,
      drinkCategory: "coffee",
      priceGbp: 3.2,
      submittedAt: Date.now() - 1,
      source: "community",
      corroborations: 2,
    };

    const priced = renderSheet([beer, coffee], "all", "ready", "coffee");
    expect(priced).toContain("£3.20");
    expect(priced).not.toContain("£5.80");

    const empty = renderSheet([beer], "all", "ready", "coffee");
    expect(empty).toContain("No coffee price logged here yet.");
    expect(empty).not.toContain("£5.80");
    expect(empty).not.toContain("alcohol-free or soft drink");
    expect(empty).not.toContain("Nobody has logged");

    const loading = renderSheet([], "all", "loading", "coffee");
    expect(loading).toContain("Checking coffee prices logged here.");
    expect(loading).not.toContain("No coffee price logged here yet.");

    const degraded = renderSheet([], "all", "degraded", "coffee");
    expect(degraded).toContain("could not read this pub");
    expect(degraded).toContain("coffee prices just now");
    expect(degraded).not.toContain("No coffee price logged here yet.");
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

  it("never calls a failed read an empty pub", () => {
    // "Nobody has logged a price here" is a fact about the pub. A read that
    // could not answer is a fact about us, and the two must not share a line.
    const html = renderToStaticMarkup(
      createElement(UnverifiedPubSheet, {
        pub,
        communityPrices: state([], false, "degraded"),
      }),
    );

    expect(html).toContain("could not read what has been logged here");
    expect(html).toContain("Prices unread");
    expect(html).not.toContain("Nobody has logged");
    expect(html).not.toContain("Checking community prices");
  });

  it("keeps the no-alcohol empty state behind an answered read", () => {
    const pending = renderSheet([], "no-alcohol", "loading");
    expect(pending).toContain("Checking community prices");
    expect(pending).not.toContain("price logged here yet");

    const failed = renderSheet([], "no-alcohol", "degraded");
    expect(failed).toContain("could not read what has been logged here");
    expect(failed).not.toContain("price logged here yet");
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

  it("does not claim overlay absence on first paint", () => {
    const html = renderSheet([]);
    expect(html).not.toContain("Pub website");
    expect(html).not.toContain("Look at the menu");
    expect(html).not.toContain("no history");
  });

  it("prints https website, menu, and cited lore only", () => {
    const html = renderToStaticMarkup(
      createElement(HarvestOverlayFields, {
        overlay: {
          website: "https://redlion.example/",
          menuUrl: "https://redlion.example/menu",
          lore: {
            source: "web",
            fact: "The Red Lion in Clapham has stood on the common since the eighteenth century.",
            sourceRef: "https://history.example/red-lion-clapham",
          },
        },
      }),
    );
    expect(html).toContain("https://redlion.example/");
    expect(html).toContain("Pub website");
    expect(html).toContain("Look at the menu");
    expect(html).toContain("The Red Lion in Clapham");
    expect(html).toContain("https://history.example/red-lion-clapham");
    expect(html).not.toMatch(/href="http:\/\//);
  });
});


describe("base published menu quote ownership", () => {
  const listed: ListedCategoryPrice = {
    source: "listed", category: "wine", drinkLabel: "Rioja, Spain",
    priceGbp: 10.5, servingSize: "250ml",
    sourceUrl: "https://www.sydneyarmschelsea.com/menu/",
    observedAt: "2026-09-29T10:40:17.846Z",
  };
  function renderPublished(
    quotes: ListedCategoryPrice[] | null | undefined,
    rows: CommunityPrice[] = [],
    readStatus: VenuePriceReadStatus = "ready",
    experienceLens: MapExperienceLens = "all",
    drinkLensCategory: CommunityPrice["drinkCategory"] | null = null,
  ) {
    const communityPrices = state(rows, true, readStatus);
    communityPrices.listedPricesByVenueId = quotes === undefined
      ? new Map() : new Map([[pub.id, quotes]]);
    return renderToStaticMarkup(createElement(UnverifiedPubSheet, {
      pub, communityPrices, experienceLens, drinkLensCategory,
    }));
  }

  it("shows an attributable exact-serving menu quote without promoting a base pub", () => {
    const html = renderPublished([listed]);
    expect(html).toContain("Prices on published menus");
    expect(html).toContain("Rioja, Spain");
    expect(html).toContain("£10.50");
    expect(html).toContain("250ml");
    expect(html).toContain("Price seen 29 September 2026");
    expect(html).toContain(`href="${listed.sourceUrl}"`);
    expect(html).not.toContain("No price yet");
    expect(html).not.toContain("that is all we know");
    expect(html).toContain("Prices never come from OpenStreetMap");
  });

  it("shows a published beer as unranked and says when its serving was not recorded", () => {
    const html = renderPublished([{
      ...listed, category: "beer", drinkLabel: null, priceGbp: 4.9, servingSize: null,
      sourceUrl: "https://donardbar.co.uk/menus/", observedAt: "2026-09-04T10:00:00Z",
    }]);
    expect(html).toContain("£4.90");
    expect(html).toContain("Serving not recorded");
    expect(html).toContain("Price seen 4 September 2026");
    expect(html).toContain('href="https://donardbar.co.uk/menus/"');
    expect(html).not.toContain("No price yet");
    expect(html).not.toContain("priceBand-");
    expect(html).not.toContain("Confirmed");
    expect(html).not.toContain("per pint");
  });

  it("keeps published and community claims separate without comparing different drinks", () => {
    const html = renderPublished([listed], [{
      id: "community-coffee", venueId: pub.id, drinkCategory: "coffee",
      priceGbp: 3.2, submittedAt: Date.now(), source: "community", corroborations: 1,
    }]);
    expect(html).toContain("£10.50");
    expect(html).toContain("£3.20");
    expect(html).toContain("Logged by a PUBMAXXER");
    expect(html.indexOf("Prices on published menus")).toBeLessThan(html.indexOf("Logged by a PUBMAXXER"));
  });

  it("does not hide a published reading when community storage is unavailable", () => {
    expect(renderPublished([listed], [], "degraded")).toContain("Rioja, Spain");
  });

  it("distinguishes pending and unavailable published reads from successful empty", () => {
    expect(renderPublished(undefined)).toContain("Checking published menu prices");
    expect(renderPublished(undefined)).not.toContain("No price yet");
    expect(renderPublished(null)).toContain("Published menu prices unavailable just now");
    expect(renderPublished(null)).not.toContain("No price yet");
    expect(renderPublished([])).toContain("No price yet");
  });

  it("does not invent a measure or answer another lens with wine", () => {
    expect(renderPublished([{ ...listed, servingSize: null }])).toContain("Serving not recorded");
    for (const [lens, category] of [["food", null], ["no-alcohol", null], ["all", "coffee"]] as const) {
      expect(renderPublished([listed], [], "ready", lens, category)).not.toContain("Rioja, Spain");
    }
  });
});
