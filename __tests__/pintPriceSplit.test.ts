// TWO DRINKERS, TWO PRICES (captain 7 Sept 2026, over Grok's reading of the
// 08:37 deploy).
//
// The pub this file is about: Hatton held two public in-window Pint Drops,
// £4.50 and £4.70, and every surface said "Logged once, needs a second
// drinker" above a door reading "Still £4.70?". The second drinker had already
// arrived and disagreed, and the product reported one of them.
//
// Four things are pinned here. (1) A DIFFERENT PRICE IS NOT CORROBORATION: the
// drop lane's agreement bar is exact and about one drink
// (lib/pintDropAgreement.ts), so £4.50 and £4.70 no longer corroborate under
// the 50p community tolerance. (2) `pintTrustFor` reads that pub as `disputed`
// and carries the figures, never a single price. (3) The Overview, the phone
// peek chip and the pin all read that ONE projection, so no surface can say
// "Logged once" over it. (4) The door asks "Which did you pay?".

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import VenueOverviewTab from "@/components/map/inspector/VenueOverviewTab";
import { pubsToGeoJSON } from "@/components/map/canvas/geojson";
import type { VenueSignal } from "@/components/map/canvas/types";
import type { CommunityPricesState } from "@/components/map/useCommunityPrices";
import { agreesWithinTolerance } from "@/lib/communityPrice";
import {
  drinkAgreementKey,
  joinPriceFigures,
  pintDropsAgree,
  pintPriceSplitLine,
  pintPriceSplitOf,
  pintPriceSplitRange,
} from "@/lib/pintDropAgreement";
import {
  CHOOSE_PRICE_DOOR_LABEL,
  dropLaneInput,
  overviewPriceDoor,
  pintTrustFor,
  pintTrustSignalFields,
  splitLaneInput,
  trustChipStateFor,
} from "@/lib/pintTrust";
import { peekPriceChip } from "@/lib/pubMap";
import {
  PROVISIONAL_PRICE_LINE,
  venueBundlePrices,
  venuePriceLane,
  venueSourcedPrice,
} from "@/lib/venuePriceLane";
import {
  corroboratedPriceDrop,
  disputedPintPrices,
  mergeVenueDrops,
  provisionalPriceDrop,
  type SummaryDrop,
  type Venue,
} from "@/lib/venues";
import { defined } from "@/__tests__/helpers/defined";

vi.mock("@/components/visits/VisitReportPanel", () => ({
  default: () => createElement("div", { "data-testid": "visit-report-peek" }),
}));

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-09-07T20:00:00.000Z");
const VENUE_ID = "venue-hatton";

const daysAgo = (days: number) => new Date(NOW - days * DAY_MS).toISOString();

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

function drop(overrides: Partial<SummaryDrop> = {}): SummaryDrop {
  return {
    drink: "Lager",
    priceGbp: 4.7,
    passedDownNote: "",
    provenance: "contributor",
    createdAt: daysAgo(1),
    handle: "tester",
    ...overrides,
  };
}

/** The Hatton lane: one drink, two figures, two drinkers, both in window. */
function hattonDrops(): SummaryDrop[] {
  return [
    drop({ priceGbp: 4.7, handle: "first", authorityKey: "key-a" }),
    drop({ priceGbp: 4.5, handle: "second", authorityKey: "key-b", createdAt: daysAgo(2) }),
  ];
}

function communityPrices(): CommunityPricesState {
  return {
    byVenueId: new Map([[VENUE_ID, []]]),
    signalsByVenueId: new Map(),
    freshestByVenueId: new Map(),
    noAlcoholIndexStatus: "idle",
    loadNoAlcoholIndex: () => {},
    loadDrinkCategoryIndex: () => {},
    drinkCategoryIndexStatus: new Map(),
    provisionalBaseVenueIds: new Set(),
    loadProvisionalBaseVenues: () => {},
    loadVenue: () => {},
    venuePriceStatus: new Map([[VENUE_ID, "ready"]]),
    submit: async () => ({ ok: true, attribution: { status: "anonymous" }, price: null }),
    submitVenueSignal: async () => ({ ok: true }),
    submitting: false,
    reportPrice: () => {},
    reportedIds: new Set(),
  } as unknown as CommunityPricesState;
}

function renderOverview(drops: SummaryDrop[]): string {
  const [merged] = mergeVenueDrops([venue()], new Map([[VENUE_ID, drops]]), NOW);
  const signal = pintTrustSignalFields(pintTrustFor(drops, NOW));
  return renderToStaticMarkup(
    createElement(VenueOverviewTab, {
      venue: defined(merged),
      tab: "overview",
      cityId: "london",
      mode: "suggest",
      inCrawl: false,
      latestContributorPrice: signal.latestContributorPrice,
      latestPintDropAt: signal.latestContributorAt,
      confirmedPrice: signal.confirmedPrice,
      provisionalPrice: dropLaneInput(
        signal.provisionalContributorPrice,
        signal.provisionalContributorAt,
      ),
      agedPrice: dropLaneInput(signal.agedContributorPrice, signal.agedContributorAt),
      disputedPrice: splitLaneInput(signal.disputedPrices, signal.disputedAt),
      communityPrices: communityPrices(),
      experienceLens: "all",
      drinkLensCategory: null,
      onToggleStop: () => {},
      presenceState: "idle",
      markPresenceHere: () => {},
      userLocation: null,
      locationRequestStatus: "idle",
      onRequestLocation: () => {},
      onClearLocation: () => {},
      onLogTonightPrice: () => {},
      onConfirmPrice: () => {},
      onOpenVisitReports: () => {},
      priceEntryAllowed: true,
      priceSignInRequested: false,
      priceAuthLoading: false,
      priceFocusRequest: 0,
    }),
  );
}

function peekChip(drops: SummaryDrop[]) {
  const [merged] = mergeVenueDrops([venue()], new Map([[VENUE_ID, drops]]), NOW);
  const signal = pintTrustSignalFields(pintTrustFor(drops, NOW));
  const bundle = venueBundlePrices(defined(merged));
  return peekPriceChip(
    venuePriceLane(
      defined(merged),
      signal.latestContributorPrice,
      venueSourcedPrice(defined(merged)),
      bundle,
      dropLaneInput(signal.provisionalContributorPrice, signal.provisionalContributorAt),
      dropLaneInput(signal.agedContributorPrice, signal.agedContributorAt),
      splitLaneInput(signal.disputedPrices, signal.disputedAt),
    ),
    bundle,
    signal.pintTrust,
  );
}

function pin(drops: SummaryDrop[]) {
  const [merged] = mergeVenueDrops([venue()], new Map([[VENUE_ID, drops]]), NOW);
  const signal: VenueSignal = {
    hasPintDrops: drops.length > 0,
    ...pintTrustSignalFields(pintTrustFor(drops, NOW)),
  };
  return pubsToGeoJSON(
    [defined(merged)],
    new Map([[VENUE_ID, signal]]),
    null,
    null,
    null,
    new Set([VENUE_ID]),
  ).features[0]!.properties as Record<string, unknown>;
}

describe("the agreement bar is exact, and about one drink", () => {
  it("refuses the 50p community tolerance that made £4.50 and £4.70 one figure", () => {
    // The rule that shipped the defect, kept where it belongs.
    expect(agreesWithinTolerance(4.5, 4.7)).toBe(true);
    expect(pintDropsAgree(drop({ priceGbp: 4.5 }), drop({ priceGbp: 4.7 }))).toBe(false);
  });

  it("agrees on the same pennies however the figure was typed", () => {
    expect(pintDropsAgree(drop({ priceGbp: 4.5 }), drop({ priceGbp: 4.5 }))).toBe(true);
    expect(pintDropsAgree(drop({ priceGbp: 4.5 }), drop({ priceGbp: 4.500001 }))).toBe(true);
    expect(pintDropsAgree(drop({ priceGbp: 4.5 }), drop({ priceGbp: 4.51 }))).toBe(false);
  });

  it("holds one price for two drinks apart, and reads case and spacing as one drink", () => {
    expect(pintDropsAgree(drop({ drink: "Guinness" }), drop({ drink: "Lager" }))).toBe(false);
    expect(drinkAgreementKey(drop({ drink: "  Camden   Hells " }))).toBe(
      drinkAgreementKey(drop({ drink: "camden hells" })),
    );
  });

  it("holds a half apart from a pint even at the same figure", () => {
    expect(pintDropsAgree(drop({ measure: "pint" }), drop({ measure: "half" }))).toBe(false);
    expect(pintDropsAgree(drop({}), drop({ measure: "pint" }))).toBe(true);
  });

  it("stops two disagreeing drinkers from corroborating a figure neither paid", () => {
    expect(corroboratedPriceDrop(hattonDrops(), NOW)).toBeNull();
    const agreeing = [
      drop({ priceGbp: 4.5, handle: "first", authorityKey: "key-a" }),
      drop({ priceGbp: 4.5, handle: "second", authorityKey: "key-b", createdAt: daysAgo(2) }),
    ];
    expect(corroboratedPriceDrop(agreeing, NOW)?.priceGbp).toBe(4.5);
  });
});

describe("the split reading", () => {
  it("finds the two figures, cheapest first, and counts the drinkers behind them", () => {
    expect(pintPriceSplitOf(hattonDrops())).toEqual({ prices: [4.5, 4.7], reporters: 2 });
    expect(disputedPintPrices(hattonDrops(), NOW)?.split).toEqual({
      prices: [4.5, 4.7],
      reporters: 2,
    });
  });

  it("says nothing over one report, or over reports that agree", () => {
    expect(disputedPintPrices([drop()], NOW)).toBeNull();
    expect(disputedPintPrices([drop({ priceGbp: 4.5 }), drop({ priceGbp: 4.5 })], NOW)).toBeNull();
  });

  it("is about ONE drink: a Guinness and a lager are two prices for two things", () => {
    const twoDrinks = [
      drop({ drink: "Lager", priceGbp: 4.7 }),
      drop({ drink: "Guinness", priceGbp: 6.2, createdAt: daysAgo(2) }),
    ];
    expect(disputedPintPrices(twoDrinks, NOW)).toBeNull();
    // The provisional lane still speaks for that pub, over the freshest drop.
    expect(provisionalPriceDrop(twoDrinks, NOW)?.priceGbp).toBe(4.7);
  });

  it("counts drinkers and prices apart: three drinkers, two figures", () => {
    // An unattributed drop carries no authority key, so it can corroborate
    // nothing; it is still a report the pub's own sheet prints, so it counts as
    // one drinker.
    const three = [
      ...hattonDrops(),
      drop({ priceGbp: 4.5, handle: "quiet", createdAt: daysAgo(3) }),
    ];
    const split = disputedPintPrices(three, NOW)!.split;
    expect(split).toEqual({ prices: [4.5, 4.7], reporters: 3 });
    expect(pintPriceSplitLine(split)).toBe("Three drinkers, two prices: £4.50 and £4.70");
  });

  it("counts one account twice as ONE drinker", () => {
    // The same key on both £4.50 rows. One account saying a figure twice is one
    // report, and the line may not turn it into two people.
    const repeated = [
      ...hattonDrops(),
      drop({ priceGbp: 4.5, handle: "second", authorityKey: "key-b", createdAt: daysAgo(3) }),
    ];
    const split = disputedPintPrices(repeated, NOW)!.split;
    expect(split).toEqual({ prices: [4.5, 4.7], reporters: 2 });
    expect(pintPriceSplitLine(split)).toBe("Two drinkers, two prices: £4.50 and £4.70");
  });

  it("reads a lane label as no drink, so the two price doors can still agree", () => {
    // The one-tap composer writes the lane's own label ("Beer"); the full Pint
    // Drop composer writes what the drinker typed. Those are not two drinks.
    expect(
      pintDropsAgree(drop({ drink: "Beer", priceGbp: 4.5 }), drop({ drink: "Guinness", priceGbp: 4.5 })),
    ).toBe(true);
    expect(
      pintDropsAgree(drop({ drink: "Beer", priceGbp: 4.5 }), drop({ drink: "Guinness", priceGbp: 4.7 })),
    ).toBe(false);
  });

  it("stands down the moment two independent drinkers agree exactly", () => {
    // Two keys on £4.50 and one lone £4.70. The best-backed figure wins, which
    // is the rule the drop lane has always kept; the split is not a veto over a
    // pub whose drinkers HAVE matched.
    const backed = [
      ...hattonDrops(),
      drop({ priceGbp: 4.5, handle: "third", authorityKey: "key-c", createdAt: daysAgo(3) }),
    ];
    expect(corroboratedPriceDrop(backed, NOW)?.priceGbp).toBe(4.5);
    expect(disputedPintPrices(backed, NOW)).toBeNull();
    expect(pintTrustFor(backed, NOW).state).toBe("corroborated");
  });

  it("words the split the same way everywhere", () => {
    expect(pintPriceSplitLine({ prices: [4.5, 4.7], reporters: 2 })).toBe(
      "Two drinkers, two prices: £4.50 and £4.70",
    );
    expect(joinPriceFigures([4.5, 4.7, 5])).toBe("£4.50, £4.70 and £5.00");
    expect(pintPriceSplitRange({ prices: [4.5, 4.7], reporters: 2 })).toBe("£4.50-£4.70");
  });
});

describe("one projection, read the same way on every surface", () => {
  it("reads disputed, carries the figures and refuses a single price", () => {
    const reading = pintTrustFor(hattonDrops(), NOW);
    expect(reading.state).toBe("disputed");
    expect(reading.priceGbp).toBeNull();
    expect(reading.split).toEqual({ prices: [4.5, 4.7], reporters: 2 });
    const signal = pintTrustSignalFields(reading);
    // The provisional pair is what printed one of two figures as the pub's own
    // report. It stays empty on a split.
    expect(signal.provisionalContributorPrice).toBeNull();
    expect(signal.latestContributorPrice).toBeNull();
    expect(signal.disputedPrices).toEqual({ prices: [4.5, 4.7], reporters: 2 });
  });

  it("the Overview says both prices and never 'Logged once'", () => {
    const html = renderOverview(hattonDrops());
    expect(html).toContain("Two drinkers, two prices: £4.50 and £4.70");
    expect(html).not.toContain(PROVISIONAL_PRICE_LINE);
    expect(html).toContain('data-pint-trust="disputed"');
    expect(html).not.toContain("No price yet");
  });

  it("the Overview door asks which of the recorded prices the reader paid", () => {
    const html = renderOverview(hattonDrops());
    expect(html).toContain(CHOOSE_PRICE_DOOR_LABEL);
    expect(html).toContain('data-price-gbp="4.50"');
    expect(html).toContain('data-price-gbp="4.70"');
    expect(html).not.toContain("Still £4.70?");
  });

  it("the peek chip prints the range and the same line, with no band", () => {
    const chip = peekChip(hattonDrops())!;
    expect(chip.figure).toBe("£4.50-£4.70");
    expect(chip.caption).toBe("Two drinkers, two prices: £4.50 and £4.70");
    expect(chip.trust).toBe("disputed");
    // Two prices have no one band, so the chip carries no figure to colour by.
    expect(chip.priceGbp).toBeNull();
  });

  it("the pin wears the mark and no price authority", () => {
    const properties = pin(hattonDrops());
    // A mark, never a figure: the split reaches no band and no printed price.
    expect(properties.provisional).toBe(true);
    expect(properties.standing).not.toBe("confirmed");
    expect(properties.price ?? null).toBeNull();
  });

  it("the chip state and the lane are one answer", () => {
    const lane = venuePriceLane(
      venue(),
      null,
      null,
      {},
      null,
      null,
      splitLaneInput({ prices: [4.5, 4.7], reporters: 2 }, NOW),
    )!;
    expect(lane.lane).toBe("disputed");
    expect(trustChipStateFor(lane, "none")).toBe("disputed");
    expect(overviewPriceDoor("disputed", lane)).toEqual({
      kind: "choose",
      label: CHOOSE_PRICE_DOOR_LABEL,
      prices: [4.5, 4.7],
    });
  });
});
