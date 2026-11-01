// THE ONE TRUST STATE, read the same way everywhere (captain's cut 5 Sept 2026,
// Fable51Fix section 1).
//
// Three things are pinned. (1) `pintTrustFor` is the composition of the four
// drop lanes in lib/venues.ts, in order, and every state is a READING at
// `now`: an expired confirmation drops back with nothing written. (2) The
// projection into a `VenueSignal` gives each state exactly the reach the
// paint table says: authority paints the band and the figure, a mark paints
// the badge, aged-out and none paint nothing. (3) The regression that may
// never return: "No price yet" and "No beer price logged here yet" while a
// visible public drop exists, on the Overview, the peek chip and the pin.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import VenueOverviewTab from "@/components/map/inspector/VenueOverviewTab";
import { pubsToGeoJSON } from "@/components/map/canvas/geojson";
import type { VenueSignal } from "@/components/map/canvas/types";
import type { CommunityPricesState } from "@/components/map/useCommunityPrices";
import { firstDropNudgeCopy } from "@/lib/firstDropNudge";
import { drinkLensEmptyVenueNote } from "@/lib/mapExperienceLens";
import { buildPintIndexSnapshotFromConfirmations } from "@/lib/pintIndexFromConfirmations";
import {
  PINT_TRUST_LINE,
  PINT_TRUST_PIN_PAINT,
  PINT_TRUST_STATES,
  dropLaneInput,
  splitLaneInput,
  pintTrustFor,
  pintTrustPinStanding,
  pintTrustSignalFields,
  trustChipStateFor,
  type PintTrustState,
} from "@/lib/pintTrust";
import { CONFIRMED_MAX_AGE_DAYS, priceStandingFor } from "@/lib/priceTier";
import { peekPriceChip } from "@/lib/pubMap";
import {
  AGED_PRICE_LINE,
  PROVISIONAL_PRICE_LINE,
  UNCHECKED_PRICE_LINE,
  uncheckedPriceLine,
  venueBundlePrices,
  venuePriceLane,
  venueSourcedPrice,
} from "@/lib/venuePriceLane";
import {
  agedPriceDrop,
  mergeVenueDrops,
  provisionalPintDropVenueIds,
  type SummaryDrop,
  type Venue,
} from "@/lib/venues";
import { defined } from "@/__tests__/helpers/defined";

vi.mock("@/components/visits/VisitReportPanel", () => ({
  default: () => createElement("div", { "data-testid": "visit-report-peek" }),
}));

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-09-05T20:00:00.000Z");
const VENUE_ID = "venue-1vle947";
const noop = () => {};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW));
});
afterEach(() => {
  vi.useRealTimers();
});

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

/** The production row: public, priced, no authority key (unlinked-handle door). */
function drop(overrides: Partial<SummaryDrop> = {}): SummaryDrop {
  return {
    drink: "Lager",
    priceGbp: 4.5,
    passedDownNote: "",
    provenance: "contributor",
    createdAt: daysAgo(4),
    handle: "tester",
    ...overrides,
  };
}

function confirmation(ageDays: number) {
  return {
    confirmationId: "conf-1",
    confirmedAt: daysAgo(ageDays),
    basis: "second_reporter" as const,
    confirmingDropId: "drop-2",
  };
}

/** A pair the server confirmed `ageDays` ago; both drops are older than that. */
function confirmedPair(ageDays = 1): SummaryDrop[] {
  return [
    drop({ handle: "Anonymous", createdAt: daysAgo(ageDays + 1), confirmation: confirmation(ageDays) }),
    drop({
      handle: "second_drinker",
      authorityKey: "account-second",
      createdAt: daysAgo(ageDays + 2),
      confirmation: confirmation(ageDays),
    }),
  ];
}

/** Two independent in-window reports the browser can prove for itself. */
function corroboratedPair(): SummaryDrop[] {
  return [
    drop({ authorityKey: "account-tester" }),
    drop({ handle: "second_drinker", authorityKey: "account-second", createdAt: daysAgo(2) }),
  ];
}

/** Two in-window drinkers, one drink, two figures: the Hatton pub of 7 Sept. */
function splitPair(): SummaryDrop[] {
  return [
    drop({ priceGbp: 4.7 }),
    drop({ handle: "second_drinker", priceGbp: 4.5, createdAt: daysAgo(2) }),
  ];
}

/** A typed price with no bill (captain decision 9, 1 Nov 2026). */
function uncheckedDrop(overrides: Partial<SummaryDrop> = {}): SummaryDrop {
  return drop({ priceEvidence: "unchecked", authorityKey: "account-tester", ...overrides });
}

const FIXTURES: Record<PintTrustState, () => SummaryDrop[]> = {
  confirmed: () => confirmedPair(),
  corroborated: () => corroboratedPair(),
  disputed: splitPair,
  "logged-once": () => [drop()],
  unchecked: () => [uncheckedDrop()],
  "aged-out": () => [drop({ createdAt: daysAgo(90) })],
  none: () => [],
};

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

/** The Overview, wired from ONE signal projection exactly as PubMap wires it. */
function renderOverview(drops: SummaryDrop[], base: Venue = venue()): string {
  const [merged] = mergeVenueDrops([base], new Map([[VENUE_ID, drops]]), NOW);
  const signal = pintTrustSignalFields(pintTrustFor(drops, NOW));
  return renderToStaticMarkup(
    createElement(VenueOverviewTab, {
      venue: defined(merged),
      tab: "overview",
      cityId: "london",
      latestContributorPrice: signal.latestContributorPrice,
      latestPintDropAt: signal.latestContributorAt,
      confirmedPrice: signal.confirmedPrice,
      provisionalPrice: dropLaneInput(
        signal.provisionalContributorPrice,
        signal.provisionalContributorAt,
        signal.uncheckedBy,
      ),
      agedPrice: dropLaneInput(signal.agedContributorPrice, signal.agedContributorAt, signal.uncheckedBy),
      disputedPrice: splitLaneInput(signal.disputedPrices, signal.disputedAt),
      communityPrices: communityPrices(VENUE_ID),
      experienceLens: "all",
      drinkLensCategory: null,
      presenceState: "idle",
      markPresenceHere: noop,
      userLocation: null,
      locationRequestStatus: "idle",
      onRequestLocation: noop,
      onClearLocation: noop,
      onLogTonightPrice: noop,
      onOpenVisitReports: noop,
      priceEntryAllowed: false,
      priceSignInRequested: false,
      priceAuthLoading: false,
      priceFocusRequest: 0,
    }),
  );
}

/** The phone peek chip, wired from the same projection. */
function peekChip(drops: SummaryDrop[], base: Venue = venue()) {
  const [merged] = mergeVenueDrops([base], new Map([[VENUE_ID, drops]]), NOW);
  const signal = pintTrustSignalFields(pintTrustFor(drops, NOW));
  const bundle = venueBundlePrices(defined(merged));
  return peekPriceChip(
    venuePriceLane(
      defined(merged),
      signal.latestContributorPrice,
      venueSourcedPrice(defined(merged)),
      bundle,
      dropLaneInput(signal.provisionalContributorPrice, signal.provisionalContributorAt, signal.uncheckedBy),
      dropLaneInput(signal.agedContributorPrice, signal.agedContributorAt, signal.uncheckedBy),
      splitLaneInput(signal.disputedPrices, signal.disputedAt),
    ),
    bundle,
    signal.pintTrust,
  );
}

/** The pin feature, wired from the same projection. */
function pin(drops: SummaryDrop[], base: Venue = venue()) {
  const [merged] = mergeVenueDrops([base], new Map([[VENUE_ID, drops]]), NOW);
  const signal: VenueSignal = { hasPintDrops: drops.length > 0, ...pintTrustSignalFields(pintTrustFor(drops, NOW)) };
  const marks = provisionalPintDropVenueIds(new Map([[VENUE_ID, drops]]), NOW);
  return pubsToGeoJSON([defined(merged)], new Map([[VENUE_ID, signal]]), null, null, null, marks).features[0]!
    .properties as Record<string, unknown>;
}

const ABSENCES = [
  "No price yet",
  "no beer price logged",
  drinkLensEmptyVenueNote("beer", "ready"),
  firstDropNudgeCopy(VENUE_ID).line,
];

describe("pintTrustFor: seven states, one order", () => {
  it("names the closed set weakest last", () => {
    expect(PINT_TRUST_STATES).toEqual([
      "confirmed",
      "corroborated",
      "disputed",
      "logged-once",
      "unchecked",
      "aged-out",
      "none",
    ]);
  });

  it.each(PINT_TRUST_STATES)("reads %s from its fixture", (state) => {
    expect(pintTrustFor(FIXTURES[state](), NOW).state).toBe(state);
  });

  it("carries the figure and the drop's own day on every priced state", () => {
    for (const state of ["confirmed", "corroborated", "logged-once", "unchecked", "aged-out"] as const) {
      const reading = pintTrustFor(FIXTURES[state](), NOW);
      expect(reading.priceGbp, state).toBe(4.5);
      expect(reading.drop, state).not.toBeNull();
      expect(reading.observedAtMs, state).toBe(Date.parse(reading.drop!.createdAt));
    }
    expect(pintTrustFor([], NOW)).toMatchObject({ state: "none", drop: null, priceGbp: null });
  });

  it("hands lib/priceTier.ts a confirmed input on `confirmed` alone, dated to the mint", () => {
    const reading = pintTrustFor(confirmedPair(3), NOW);
    expect(reading.confirmedPrice).toEqual({ priceGbp: 4.5, observedAt: daysAgo(3) });
    expect(priceStandingFor({ confirmed: reading.confirmedPrice }, NOW).standing).toBe("confirmed");
    for (const state of ["corroborated", "disputed", "logged-once", "unchecked", "aged-out", "none"] as const) {
      expect(pintTrustFor(FIXTURES[state](), NOW).confirmedPrice, state).toBeNull();
    }
  });

  it("a confirmation past the window drops back to aged-out at READ time, and nothing is written", () => {
    const pair = confirmedPair(CONFIRMED_MAX_AGE_DAYS + 1);
    const before = JSON.stringify(pair);
    const reading = pintTrustFor(pair, NOW);
    expect(reading.state).toBe("aged-out");
    expect(reading.priceGbp).toBe(4.5);
    expect(reading.confirmedPrice).toBeNull();
    expect(priceStandingFor({ confirmed: reading.confirmedPrice }, NOW).standing).toBe("none");
    expect(JSON.stringify(pair)).toBe(before);
    // The same pair read one day earlier is still confirmed: the boundary is
    // the window's own, and the state is a function of `now`.
    expect(pintTrustFor(pair, NOW - DAY_MS - 1).state).toBe("confirmed");
  });

  it("the window is the one lib/priceTier.ts owns, to the day", () => {
    expect(pintTrustFor(confirmedPair(CONFIRMED_MAX_AGE_DAYS), NOW).state).toBe("confirmed");
    expect(pintTrustFor([drop({ createdAt: daysAgo(CONFIRMED_MAX_AGE_DAYS) })], NOW).state).toBe("logged-once");
    expect(pintTrustFor([drop({ createdAt: daysAgo(CONFIRMED_MAX_AGE_DAYS + 1) })], NOW).state).toBe("aged-out");
  });

  it("a demo seed and an unpriced note read as none, and a future-dated row is never aged", () => {
    expect(pintTrustFor([drop({ provenance: "demo" })], NOW).state).toBe("none");
    expect(pintTrustFor([drop({ priceGbp: null, passedDownNote: "Grandad's local." })], NOW).state).toBe("none");
    expect(agedPriceDrop([drop({ createdAt: daysAgo(-1) })], NOW)).toBeNull();
  });

  it("one aged report and one fresh one read as logged-once: the fresh report speaks", () => {
    const reading = pintTrustFor([drop({ createdAt: daysAgo(90) }), drop({ createdAt: daysAgo(1) })], NOW);
    expect(reading.state).toBe("logged-once");
    expect(reading.observedAtMs).toBe(Date.parse(daysAgo(1)));
  });
});

// Captain decision 9 (1 Nov 2026): a typed price without a bill saves and shows
// as "logged by @handle, not checked" with its date. It does not colour the pin
// until a second, independent person confirms it.
describe("an unchecked price (no bill): the sheet, never the map, until a second drinker", () => {
  it("a billed report outranks it, and it outranks a report past the window", () => {
    expect(pintTrustFor([uncheckedDrop(), drop({ handle: "billed", createdAt: daysAgo(2) })], NOW).state).toBe(
      "logged-once",
    );
    expect(pintTrustFor([uncheckedDrop(), drop({ createdAt: daysAgo(90) })], NOW).state).toBe("unchecked");
  });

  it("alone it never marks the pin, paints a band or prints a figure on it", () => {
    const lone = pin([uncheckedDrop()]);
    expect(lone.priceLabel).toBeUndefined();
    expect(lone.provisional).toBe(false);
    expect(lone.standing).toBeUndefined();
    // The same price WITH a bill marks the pin: that is what the bill buys.
    expect(pin([drop()]).provisional).toBe(true);
  });

  it("alone it never enters a cheapest claim: the merge leaves the pub's price as it was", () => {
    const [merged] = mergeVenueDrops([venue({ cheapestPrice: 6.2 })], new Map([[VENUE_ID, [uncheckedDrop({ priceGbp: 3.1 })]]]), NOW);
    expect(defined(merged).cheapestPrice).toBe(6.2);
    expect(defined(merged).latestContributorPrice).toBeNull();
  });

  it("two of them from ONE account are still one unchecked price", () => {
    const sameAccount = [uncheckedDrop(), uncheckedDrop({ createdAt: daysAgo(2) })];
    expect(pintTrustFor(sameAccount, NOW).state).toBe("unchecked");
    expect(pin(sameAccount).priceLabel).toBeUndefined();
  });

  it("a second independent drinker agreeing paints it, billed or not", () => {
    for (const second of [
      drop({ handle: "second_drinker", authorityKey: "account-second", createdAt: daysAgo(2) }),
      uncheckedDrop({ handle: "second_drinker", authorityKey: "account-second", createdAt: daysAgo(2) }),
    ]) {
      const pair = [uncheckedDrop(), second];
      expect(pintTrustFor(pair, NOW).state).toBe("corroborated");
      const painted = pin(pair);
      expect(painted.priceLabel).toBe("£4.50");
      expect(painted.provisional).toBe(false);
      const [merged] = mergeVenueDrops([venue({ cheapestPrice: 6.2 })], new Map([[VENUE_ID, pair]]), NOW);
      expect(defined(merged).cheapestPrice).toBe(4.5);
    }
  });

  it("a minted confirmation over it paints it and reads confirmed", () => {
    const pair = confirmedPair(1).map((row) => ({ ...row, priceEvidence: "unchecked" as const }));
    expect(pintTrustFor(pair, NOW).state).toBe("confirmed");
    expect(pin(pair).priceLabel).toBe("£4.50");
  });

  it("past the window it ages out like any report, and keeps its name off the band", () => {
    const aged = [uncheckedDrop({ createdAt: daysAgo(90) })];
    expect(pintTrustFor(aged, NOW).state).toBe("aged-out");
    expect(pintTrustSignalFields(pintTrustFor(aged, NOW)).uncheckedBy).toBe("tester");
    expect(pin(aged).provisional).toBe(false);
  });
});

describe("what each state paints on the pin", () => {
  it("is written once, in the paint table", () => {
    expect(PINT_TRUST_PIN_PAINT).toEqual({
      confirmed: "authority",
      corroborated: "authority",
      // A split has reports but no agreed figure, so it wears the same mark one
      // report wears and reaches no band.
      disputed: "mark",
      "logged-once": "mark",
      // Captain decision 9: a price with no bill touches the pin not at all.
      unchecked: "none",
      "aged-out": "none",
      none: "none",
    });
  });

  it("authority paints the band and the figure; a mark paints the badge; the rest paint nothing", () => {
    const confirmed = pin(confirmedPair());
    expect(confirmed.bucket).not.toBe(3);
    expect(confirmed.priceLabel).toBe("£4.50");
    expect(confirmed.provisional).toBe(false);

    const corroborated = pin(corroboratedPair());
    expect(corroborated.priceLabel).toBe("£4.50");
    expect(corroborated.provisional).toBe(false);

    const loggedOnce = pin([drop()]);
    expect(loggedOnce.priceLabel).toBeUndefined();
    expect(loggedOnce.provisional).toBe(true);

    const unchecked = pin([uncheckedDrop()]);
    expect(unchecked.priceLabel).toBeUndefined();
    expect(unchecked.provisional).toBe(false);

    const aged = pin([drop({ createdAt: daysAgo(90) })]);
    expect(aged.priceLabel).toBeUndefined();
    expect(aged.provisional).toBe(false);

    const none = pin([]);
    expect(none.priceLabel).toBeUndefined();
    expect(none.provisional).toBe(false);
  });

  it("the tag wears the confirmed standing on `confirmed` and nothing on its own otherwise", () => {
    expect(pin(confirmedPair()).standing).toBe("confirmed");
    expect(pin(corroboratedPair()).standing).toBeUndefined();
    expect(pin([drop()]).standing).toBeUndefined();
    expect(pintTrustPinStanding("confirmed")).toBe("confirmed");
    for (const state of ["corroborated", "logged-once", "unchecked", "aged-out", "none"] as const) {
      expect(pintTrustPinStanding(state), state).toBeNull();
    }
  });

  it("an expired confirmation un-paints the pin at read time", () => {
    const expired = pin(confirmedPair(CONFIRMED_MAX_AGE_DAYS + 1));
    expect(expired.standing).toBeUndefined();
    expect(expired.priceLabel).toBeUndefined();
    expect(expired.provisional).toBe(false);
  });

  it("confirmed may lead the cheapest-pint story: the merge takes its figure", () => {
    const [merged] = mergeVenueDrops(
      [venue({ cheapestPrice: 6.2 })],
      new Map([[VENUE_ID, confirmedPair()]]),
      NOW,
    );
    expect(defined(merged).cheapestPrice).toBe(4.5);
    expect(defined(merged).latestContributorPrice).toBe(4.5);
    const [lone] = mergeVenueDrops([venue({ cheapestPrice: 6.2 })], new Map([[VENUE_ID, [drop()]]]), NOW);
    expect(defined(lone).cheapestPrice).toBe(6.2);
    expect(defined(lone).latestContributorPrice).toBeNull();
  });
});

describe("the signal projection gives each state its reach and no more", () => {
  it.each(PINT_TRUST_STATES)("%s", (state) => {
    const fields = pintTrustSignalFields(pintTrustFor(FIXTURES[state](), NOW));
    const paint = PINT_TRUST_PIN_PAINT[state];
    expect(fields.pintTrust).toBe(state);
    expect(fields.latestContributorPrice).toBe(paint === "authority" ? 4.5 : null);
    // An unchecked report sits in the lone-report slot beside a billed one, and
    // `uncheckedBy` is the only field that tells them apart.
    expect(fields.provisionalContributorPrice).toBe(
      state === "logged-once" || state === "unchecked" ? 4.5 : null,
    );
    expect(fields.uncheckedBy).toBe(state === "unchecked" ? "tester" : null);
    expect(fields.agedContributorPrice).toBe(state === "aged-out" ? 4.5 : null);
    expect(fields.confirmedPrice === null).toBe(state !== "confirmed");
  });
});

describe("the Overview chip", () => {
  it.each(["confirmed", "corroborated", "logged-once", "unchecked", "aged-out"] as const)(
    "carries data-pint-trust=%s and the venue id, and words no absence",
    (state) => {
      const html = renderOverview(FIXTURES[state]());
      expect(html).toContain(`data-pint-trust="${state}"`);
      expect(html).toContain(`data-venue-id="${VENUE_ID}"`);
      expect(html).toContain("£4.50");
      for (const absence of ABSENCES) expect(html, `${state}: ${absence}`).not.toContain(absence);
    },
  );

  it("prints the trust pill on confirmed alone, dated to the mint", () => {
    const html = renderOverview(confirmedPair(3));
    expect(html).toContain('data-standing="confirmed"');
    expect(html).toContain("Confirmed");
    for (const state of ["corroborated", "logged-once", "aged-out"] as const) {
      expect(renderOverview(FIXTURES[state]()), state).not.toContain("trustPill");
    }
  });

  it("prints each state's one line", () => {
    expect(PINT_TRUST_LINE["logged-once"]).toBe(PROVISIONAL_PRICE_LINE);
    expect(PINT_TRUST_LINE.unchecked).toBe(UNCHECKED_PRICE_LINE);
    expect(PINT_TRUST_LINE["aged-out"]).toBe(AGED_PRICE_LINE);
    expect(renderOverview([drop()])).toContain(PROVISIONAL_PRICE_LINE);
    expect(renderOverview([uncheckedDrop()])).toContain(UNCHECKED_PRICE_LINE);
    expect(renderOverview([drop({ createdAt: daysAgo(90) })])).toContain(AGED_PRICE_LINE);
    expect(renderOverview(corroboratedPair())).toContain("Latest price from a drinker");
  });

  it("prints an unchecked price as a dated, named row on the neutral plaque", () => {
    const html = renderOverview([uncheckedDrop()]);
    expect(html).toContain("Logged by @tester, not checked");
    expect(html).toContain("logged 4 days ago");
    expect(html).toContain('data-price-check="unchecked"');
    // Colour means the price band, never trust: the figure wears no band.
    const row = /<div class="contributorPrice"[^>]*data-price-check="unchecked"[\s\S]*?<\/div>/.exec(html)?.[0] ?? "";
    expect(row).toContain("£4.50");
    expect(row).not.toMatch(/priceBand-(cheap|average|expensive)/);
    // The same price with a bill wears its band, and says nothing about checking.
    const billed = renderOverview([drop()]);
    expect(billed).toMatch(/priceBand-(cheap|average|expensive)/);
    expect(billed).not.toContain("not checked");
  });

  it("reads the unchecked state off the lane, never off a branch of its own", () => {
    const lane = { lane: "provisional" as const, provisionalPrice: 4.5, observedAt: null };
    expect(trustChipStateFor(lane, "none")).toBe("logged-once");
    expect(trustChipStateFor({ ...lane, uncheckedBy: "tester" }, "none")).toBe("unchecked");
    expect(trustChipStateFor({ lane: "aged", agedPrice: 4.5, observedAt: null, uncheckedBy: "tester" }, "none")).toBe(
      "aged-out",
    );
  });

  it("words the absence only when there is no public drop at all", () => {
    const html = renderOverview([]);
    expect(html).toContain(firstDropNudgeCopy(VENUE_ID).line);
    expect(html).not.toContain("data-pint-trust=");
  });

  it("a non-drop lane carries no chip state", () => {
    expect(renderOverview([], venue({ cheapestPrice: 6.2 }))).not.toContain("data-pint-trust=");
    expect(trustChipStateFor({ lane: "baseline", standing: "none", publisher: null, observedOn: null, cheapestPrice: 6.2 }, "none")).toBeNull();
    expect(trustChipStateFor(null, "none")).toBeNull();
  });
});

describe("the phone peek chip", () => {
  it.each(["confirmed", "corroborated", "logged-once", "aged-out"] as const)(
    "prints the figure and carries %s",
    (state) => {
      const chip = peekChip(FIXTURES[state]());
      expect(chip).not.toBeNull();
      expect(chip!.figure).toBe("£4.50");
      expect(chip!.trust).toBe(state);
      expect(chip!.caption).toBe(PINT_TRUST_LINE[state] ?? "current recorded price");
    },
  );

  it("prints an unchecked price named and unbanded", () => {
    const chip = peekChip([uncheckedDrop()]);
    expect(chip).not.toBeNull();
    expect(chip!.figure).toBe("£4.50");
    expect(chip!.trust).toBe("unchecked");
    expect(chip!.caption).toBe(uncheckedPriceLine("tester"));
    // `priceGbp` is what the chip bands, so withholding it keeps the band off.
    expect(chip!.priceGbp).toBeNull();
  });

  it("answers null, the one branch that may word an absence, only on none", () => {
    expect(peekChip([])).toBeNull();
  });
});

describe("the Pint Index cites the same confirmations this module calls confirmed", () => {
  function snapshotFor(drops: SummaryDrop[]) {
    return buildPintIndexSnapshotFromConfirmations({
      drops: drops.map((row, index) => ({
        id: `drop-${index + 1}`,
        venueId: VENUE_ID,
        priceGbp: row.priceGbp,
        createdAt: row.createdAt,
        confirmation: row.confirmation ?? null,
      })),
      venues: new Map([[VENUE_ID, { name: "The Sir Christopher Hatton", lat: 51.52, lng: -0.11 }]]),
      classify: () => "Camden",
      snapshotId: "test",
      generatedAt: new Date(NOW).toISOString(),
      classification: { method: "point_in_polygon", boundarySource: "test", boundaryVersion: "1" },
      publisher: "PUBMAXX",
      dropUrl: (id: string) => `https://pubmaxxing.com/drops/${id}`,
      licence: null,
    } as unknown as Parameters<typeof buildPintIndexSnapshotFromConfirmations>[0]);
  }

  it("a live confirmation is cited; an expired one is counted out, as this module reads it", () => {
    const live = snapshotFor(confirmedPair(3));
    expect(pintTrustFor(confirmedPair(3), NOW).state).toBe("confirmed");
    expect(live.published).toBeGreaterThan(0);

    const expired = snapshotFor(confirmedPair(CONFIRMED_MAX_AGE_DAYS + 1));
    expect(pintTrustFor(confirmedPair(CONFIRMED_MAX_AGE_DAYS + 1), NOW).state).toBe("aged-out");
    expect(expired.published).toBe(0);
  });

  it("an unchecked price alone is never cited; once a second drinker's confirmation is minted, it is", () => {
    expect(snapshotFor([uncheckedDrop()]).published).toBe(0);
    const confirmed = confirmedPair(3).map((row) => ({ ...row, priceEvidence: "unchecked" as const }));
    expect(snapshotFor(confirmed).published).toBeGreaterThan(0);
  });
});

describe("the regression fence in source", () => {
  const read = (file: string) => readFileSync(join(process.cwd(), file), "utf8");

  it("every drop-lane field of the map signal is projected from ONE reading", () => {
    const source = read("components/map/usePintDrops.ts");
    expect(source).toContain("pintTrustSignalFields(pintTrustFor(venueDrops))");
    for (const lane of ["authoritativePriceDrop(", "confirmedPriceInputFor(", "provisionalPriceDrop(", "agedPriceDrop("]) {
      expect(source, lane).not.toContain(lane);
    }
  });

  it("the sheet, the peek and the pin all read the shared state rather than a lane of their own", () => {
    expect(read("components/map/inspector/VenueOverviewTab.tsx")).toContain("trustChipStateFor(lane, priceStanding.standing)");
    expect(read("lib/pubMap.ts")).toContain("trustChipStateFor(lane,");
    expect(read("components/map/canvas/geojson.ts")).toContain("pintTrustPinStanding(signals?.pintTrust)");
    expect(read("components/PubMap.tsx")).toMatch(/<VenuePeekPintPrice[\s\S]*?pintTrust=\{peekDropSignal\?\.pintTrust \?\? null\}/);
    expect(read("components/map/VenuePeekPintPrice.tsx")).toContain("data-pint-trust={price.trust ?? undefined}");
  });
});

// Owner decision 16 Oct 2026: an aging price must look aging on the sheet as
// on the pin, never fresh. The price on record ages on the listing window, so
// a read over a year ago, or no read at all, breaks the plaque's edge and says
// why in words; a recent read gets neither. Colour stays the band's.
describe("an aging price on record looks aging", () => {
  const onRecord = (scrapedAt: string) =>
    venue({
      cheapestPrice: 4.5,
      prices: [
        {
          pub_name: "The Sir Christopher Hatton",
          beer_name: "Lager",
          price_gbp: 4.5,
          pub_url: "https://example.com/hatton",
          scraped_at_values: scrapedAt,
        },
      ] as unknown as Venue["prices"],
    });

  it("leaves a price read this month clean", () => {
    const html = renderOverview([], onRecord(daysAgo(10)));
    expect(html).toContain("£4.50");
    expect(html).not.toContain("priceBadge--aging");
    expect(html).not.toContain('data-price-age="aging"');
  });

  it("breaks the plaque's edge and says why when the read is over a year old", () => {
    const html = renderOverview([], onRecord(daysAgo(400)));
    expect(html).toContain("£4.50");
    expect(html).toMatch(/class="[^"]*priceBadge--aging[^"]*"/);
    expect(html).toContain("Read over a year ago, so this price may have changed.");
  });

  it("never lets a price with no read date look fresh", () => {
    const html = renderOverview([], onRecord(""));
    expect(html).toMatch(/class="[^"]*priceBadge--aging[^"]*"/);
    expect(html).toContain("No read date on record, so this price may have changed.");
  });
});
