// A lone public Pint Drop, end to end (issue #1426).
//
// Production showed the venue Overview saying "No price yet" over The Sir
// Christopher Hatton while its Drinks tab held a public £4.50 Lager logged by
// handle `tester`. Three seams kept that drop off the price area: corroboration
// needs two in-window drops, each needs a non-null authority key and that row
// has none, and `/api/venue/[id]` never merges drops at all.
//
// The fix leaves all three alone. The corroboration gate still owns pin colour,
// cheapest buckets and the Pint Index; a fifth `provisional` lane shows the
// figure the drinker logged, dated, with the one line saying what it lacks.
//
// These cases run the pipeline in the order PubMap runs it: drops fold into the
// signal through `provisionalPriceDrop`, and the overview tab renders the lane.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import VenueOverviewTab from "@/components/map/inspector/VenueOverviewTab";
import type { CommunityPricesState } from "@/components/map/useCommunityPrices";
import { firstDropNudgeCopy } from "@/lib/firstDropNudge";
import { PROVISIONAL_PRICE_LINE } from "@/lib/venuePriceLane";
import {
  corroboratedPriceDrop,
  mergeVenueDrops,
  provisionalPriceDrop,
  type SummaryDrop,
  type Venue,
} from "@/lib/venues";

vi.mock("@/components/visits/VisitReportPanel", () => ({
  default: () => createElement("div", { "data-testid": "visit-report-peek" }),
}));

// The freshness label reads the wall clock, so the day the sheet prints is
// pinned rather than left to drift with the run.
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW));
});

afterEach(() => {
  vi.useRealTimers();
});

const noop = () => {};
const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-09-04T20:00:00.000Z");
const YESTERDAY = new Date(NOW - DAY_MS).toISOString();
const VENUE_ID = "venue-1vle947";

function venue(overrides: Partial<Venue> = {}): Venue {
  return {
    id: VENUE_ID,
    name: "The Sir Christopher Hatton",
    address: "4 Leather Lane",
    latitude: 51.52,
    longitude: -0.11,
    primaryBorough: "Camden",
    visibleBoroughs: [],
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
    kind: "pub",
    ...overrides,
  } as Venue;
}

// The production row: a public drop by a handle with NO authority key, because
// it came through the unlinked-handle door.
function drop(overrides: Partial<SummaryDrop> = {}): SummaryDrop {
  return {
    drink: "Lager",
    priceGbp: 4.5,
    passedDownNote: "",
    provenance: "contributor",
    createdAt: YESTERDAY,
    handle: "tester",
    ...overrides,
  };
}

function communityPrices(venueId: string): CommunityPricesState {
  return {
    byVenueId: new Map([[venueId, []]]),
    signalsByVenueId: new Map(),
    freshestByVenueId: new Map(),
    noAlcoholIndexStatus: "idle",
    loadNoAlcoholIndex: noop,
    loadDrinkCategoryIndex: noop,
    drinkCategoryIndexStatus: new Map(),
    provisionalBaseVenueIds: new Set(),
    loadProvisionalBaseVenues: noop,
    loadVenue: noop,
    venuePriceStatus: new Map([[venueId, "ready"]]),
    submit: async () => ({ ok: true, attribution: { status: "anonymous" }, price: null }),
    submitVenueSignal: async () => ({ ok: true }),
    submitting: false,
    reportPrice: noop,
    reportedIds: new Set(),
  } as unknown as CommunityPricesState;
}

/** The whole path a selected venue takes, exactly as PubMap wires it. */
function renderSelectedVenue(drops: SummaryDrop[], base: Venue = venue()): string {
  const [merged] = mergeVenueDrops([base], new Map([[VENUE_ID, drops]]), NOW);
  const corroborated = corroboratedPriceDrop(drops, NOW);
  const provisional = provisionalPriceDrop(drops, NOW);
  return renderToStaticMarkup(
    createElement(VenueOverviewTab, {
      venue: merged,
      tab: "overview",
      cityId: "london",
      mode: "suggest",
      inCrawl: false,
      latestContributorPrice: corroborated?.priceGbp ?? null,
      provisionalPrice: provisional
        ? {
            priceGbp: provisional.priceGbp as number,
            observedAt: Date.parse(provisional.createdAt),
          }
        : null,
      communityPrices: communityPrices(VENUE_ID),
      experienceLens: "all",
      onToggleStop: noop,
      presenceState: "idle",
      markPresenceHere: noop,
      userLocation: null,
      locationRequestStatus: "idle",
      onRequestLocation: noop,
      onClearLocation: noop,
      onLogTonightPrice: noop,
      onStartFirstDrop: noop,
      onOpenVisitReports: noop,
      priceEntryAllowed: false,
      priceSignInRequested: false,
      priceAuthLoading: false,
      priceFocusRequest: 0,
    }),
  );
}

describe("a lone public Pint Drop on the venue Overview", () => {
  it("prints the drinker's figure instead of the first-drop nudge", () => {
    const html = renderSelectedVenue([drop()]);
    expect(html).toContain("£4.50");
    expect(html).not.toContain(firstDropNudgeCopy(VENUE_ID).line);
  });

  it("says what it still needs, in the one wording the lane owns", () => {
    expect(renderSelectedVenue([drop()])).toContain(PROVISIONAL_PRICE_LINE);
  });

  it("dates the report, because a price with no day is not evidence", () => {
    expect(renderSelectedVenue([drop()])).toContain("logged 1 day ago");
  });

  it("wears no trust pill: `listed` means published with a page, and this is not", () => {
    const html = renderSelectedVenue([drop()]);
    expect(html).not.toContain("trustPill");
    expect(html).not.toContain("data-standing=");
  });

  it("shows over a pub the curated dataset already priced, above the baseline", () => {
    const html = renderSelectedVenue([drop()], venue({ cheapestPrice: 6.2 }));
    expect(html).toContain("£4.50");
    expect(html).toContain(PROVISIONAL_PRICE_LINE);
    expect(html).not.toContain("Baseline on record");
  });

  it("two drops from ONE drinker stay provisional, because that is still one report", () => {
    const drops = [
      drop({ priceGbp: 4.5, handle: "tester", authorityKey: "account-tester" }),
      drop({
        priceGbp: 4.6,
        handle: "tester",
        authorityKey: "account-tester",
        createdAt: new Date(NOW - 2 * DAY_MS).toISOString(),
      }),
    ];
    expect(corroboratedPriceDrop(drops, NOW)).toBeNull();
    expect(renderSelectedVenue(drops)).toContain(PROVISIONAL_PRICE_LINE);
  });

  it("two independent drinkers take the contributor lane and drop the line", () => {
    const drops = [
      drop({ priceGbp: 4.5, handle: "tester", authorityKey: "account-tester" }),
      drop({
        priceGbp: 4.5,
        handle: "second_drinker",
        authorityKey: "account-second",
        createdAt: new Date(NOW - 2 * DAY_MS).toISOString(),
      }),
    ];
    const html = renderSelectedVenue(drops);
    expect(html).toContain("Latest Pint Drop price");
    expect(html).toContain("£4.50");
    expect(html).not.toContain(PROVISIONAL_PRICE_LINE);
  });

  it("an aged-out report leaves the pub unpriced and invites the first drop", () => {
    const html = renderSelectedVenue([
      drop({ createdAt: new Date(NOW - 90 * DAY_MS).toISOString() }),
    ]);
    expect(html).not.toContain("£4.50");
    expect(html).not.toContain(PROVISIONAL_PRICE_LINE);
    expect(html).toContain(firstDropNudgeCopy(VENUE_ID).line);
  });

  it("never moves the map: the projection and the corroboration gate are untouched", () => {
    const [merged] = mergeVenueDrops([venue()], new Map([[VENUE_ID, [drop()]]]), NOW);
    expect(merged.cheapestPrice).toBeNull();
    expect(merged.latestContributorPrice).toBeNull();
    expect(corroboratedPriceDrop([drop()], NOW)).toBeNull();
  });
});
