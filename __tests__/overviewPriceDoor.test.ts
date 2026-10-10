// @vitest-environment jsdom

// THE OVERVIEW HAS ONE PRICE DOOR PER TRUST STATE (captain's rule from the
// core-loop battle test L03, 5 Sept 2026: one button system, one clear
// primary per screen).
//
// The Overview used to offer four to eight price actions on one sheet: the
// first-drop nudge and its "Or leave a Pint Drop", the prices-by-drink "Log a
// beer price", the second drinker's "Still £4.50?", the sticky bar's "Add
// price", and an always-open composer with "Log it" and its chips. Three
// things are pinned here. (1) `overviewPriceDoor` (lib/pintTrust.ts) names
// exactly one door for every state in the closed set, and the confirm door
// from #1492 stays the primary where it applies. (2) The rendered Overview
// carries exactly one `[data-price-door]` per state, and none of the retired
// doors. (3) The composer is FOLDED until the door opens it, and the door
// folds away once it has, so the two never stand on one screen.

import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import VenueOverviewTab, {
  drinkInviteOwnedByPriceArea,
  overviewComposerOpen,
} from "@/components/map/inspector/VenueOverviewTab";
import FirstDropNudge from "@/components/map/inspector/FirstDropNudge";
import VenueStickyBar from "@/components/map/inspector/VenueStickyBar";
import type { PricedVenue } from "@/lib/priceUpdates";
import type { VenueDropReadStatus } from "@/lib/venueDropRead";
import { useCommunityPrices, type CommunityPricesState } from "@/components/map/useCommunityPrices";
import { usePintDrops, type DropWithPhotos, type PintDropsState } from "@/components/map/usePintDrops";
import type { VenuePriceReadStatus } from "@/lib/mapExperienceLens";
import { drinkLaneLogActionLabel } from "@/lib/drinkLanes";
import { firstDropNudgeCopy } from "@/lib/firstDropNudge";
import {
  confirmPintActionLabel,
  confirmPintActionName,
  secondDrinkerDoorOffered,
} from "@/lib/pintDropSecondDrinker";
import {
  CHOOSE_PRICE_DOOR_LABEL,
  LOG_PRICE_DOOR_LABEL,
  OVERVIEW_PRICE_DOOR_KIND,
  PINT_TRUST_STATES,
  dropLaneInput,
  overviewPriceDoor,
  pintTrustFor,
  pintTrustSignalFields,
  splitLaneInput,
  type PintTrustState,
} from "@/lib/pintTrust";
import {
  BASELINE_NO_PUBLISHER_CAPTION,
  venueBundlePrices,
  venuePriceFallbackPending,
  venuePriceLane,
  venueSourcedPrice,
  type VenuePriceLane,
} from "@/lib/venuePriceLane";
import { mergeVenueDrops, type SummaryDrop, type Venue } from "@/lib/venues";
import { defined } from "@/__tests__/helpers/defined";

vi.mock("@/components/visits/VisitReportPanel", () => ({
  default: () => createElement("div", { "data-testid": "visit-report-peek" }),
}));

vi.mock("@/components/auth/authContext", () => ({
  useAuth: () => ({
    user: null, session: null, loading: false, configured: false,
    handle: null, identityResolved: true, getCurrentUserId: () => null,
  }),
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

function daysAgo(days: number): string {
  return new Date(NOW - days * DAY_MS).toISOString();
}

function drop(overrides: Partial<SummaryDrop> = {}): SummaryDrop {
  return {
    drink: "Lager",
    priceGbp: 4.5,
    passedDownNote: "",
    provenance: "contributor",
    createdAt: daysAgo(1),
    handle: "tester",
    ...overrides,
  };
}

function confirmedPair(): SummaryDrop[] {
  const confirmation = {
    confirmationId: "conf-1",
    confirmedAt: daysAgo(1),
    basis: "second_reporter" as const,
    confirmingDropId: "drop-2",
  };
  return [
    drop({ id: "drop-1", authorityKey: "key-a", confirmation, createdAt: daysAgo(2) } as Partial<SummaryDrop>),
    drop({ id: "drop-2", handle: "second", authorityKey: "key-b", confirmation, createdAt: daysAgo(3) } as Partial<SummaryDrop>),
  ];
}

/** Every trust state, as drops, plus the two non-drop lanes the sheet prints. */
const FIXTURES: Record<PintTrustState, () => SummaryDrop[]> = {
  confirmed: confirmedPair,
  corroborated: () => [
    drop({ authorityKey: "key-a" }),
    drop({ handle: "second", authorityKey: "key-b", createdAt: daysAgo(2) }),
  ],
  // Two drinkers, two prices, one drink: the Hatton pub Grok read on the 08:37
  // deploy (captain 7 Sept 2026).
  disputed: () => [
    drop({ priceGbp: 4.7 }),
    drop({ handle: "second", priceGbp: 4.5, createdAt: daysAgo(2) }),
  ],
  "logged-once": () => [drop()],
  "aged-out": () => [drop({ createdAt: daysAgo(90) })],
  none: () => [],
};

function communityPrices(venueId: string, readStatus: VenuePriceReadStatus = "ready"): CommunityPricesState {
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
    venuePriceStatus: new Map([[venueId, readStatus]]),
    submit: async () => ({ ok: true, attribution: { status: "anonymous" }, price: null }),
    submitVenueSignal: async () => ({ ok: true }),
    submitting: false,
    reportPrice: noop,
    reportedIds: new Set(),
  } as unknown as CommunityPricesState;
}

function renderOverview(
  drops: SummaryDrop[],
  base: Venue = venue(),
  options: { priceFocusRequest?: number; priceSignInRequested?: boolean; withConfirm?: boolean; priceReadStatus?: VenuePriceReadStatus; dropReadStatus?: VenueDropReadStatus; communityState?: CommunityPricesState } = {},
): string {
  const [merged] = mergeVenueDrops([base], new Map([[VENUE_ID, drops]]), NOW);
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
      provisionalPrice: dropLaneInput(signal.provisionalContributorPrice, signal.provisionalContributorAt),
      agedPrice: dropLaneInput(signal.agedContributorPrice, signal.agedContributorAt),
      disputedPrice: splitLaneInput(signal.disputedPrices, signal.disputedAt),
      communityPrices: options.communityState ?? communityPrices(VENUE_ID, options.priceReadStatus),
      dropReadStatus: options.dropReadStatus,
      experienceLens: "all",
      drinkLensCategory: null,
      onToggleStop: noop,
      presenceState: "idle",
      markPresenceHere: noop,
      userLocation: null,
      locationRequestStatus: "idle",
      onRequestLocation: noop,
      onClearLocation: noop,
      onLogTonightPrice: noop,
      onConfirmPrice: options.withConfirm === false ? undefined : noop,
      onOpenVisitReports: noop,
      // Keyless: the account rules admit the composer, as the e2e server does.
      priceEntryAllowed: true,
      priceSignInRequested: options.priceSignInRequested ?? false,
      priceAuthLoading: false,
      priceFocusRequest: options.priceFocusRequest ?? 0,
    }),
  );
}

const doorCount = (html: string) => html.split('data-price-door="').length - 1;

describe("renewed venue price reads", () => {
  type ReadRequest = {
    path: string;
    resolve: (response: Response) => void;
    reject: (error: Error) => void;
  };
  let container: HTMLDivElement;
  let root: Root;
  let reads: ReadRequest[];
  let drops: PintDropsState;
  let prices: CommunityPricesState;
  const otherId = "venue-other";
  const estimated = () => venue({
    bundlePrices: {
      estimate: { priceGbp: 6.5, computedAt: daysAgo(1), basis: "regional_baseline:camden", sampleSize: 8 },
    },
  } as Partial<Venue>);
  const observed = (): DropWithPhotos => ({
    ...drop({ priceGbp: 4.7 }),
    id: "fresh-drop", venueId: VENUE_ID, handle: "tester", drink: "Lager",
    priceGbp: 4.7, passedDownNote: "", era: "", provenance: "contributor",
    status: "visible", createdAt: daysAgo(1), pintPhotoUrl: null, venuePhotoUrl: null,
  });

  function ReadProbe({ selectedId }: { selectedId: string }) {
    const dropState = usePintDrops();
    const priceState = useCommunityPrices();
    const { refreshVenueDrops } = dropState;
    const { loadVenue } = priceState;
    useEffect(() => {
      loadVenue(selectedId);
      return refreshVenueDrops(selectedId);
    }, [selectedId, refreshVenueDrops, loadVenue]);
    useEffect(() => {
      drops = dropState;
      prices = priceState;
    }, [dropState, priceState]);
    return null;
  }

  async function select(selectedId: string) {
    await act(async () => { root.render(createElement(ReadProbe, { selectedId })); });
  }

  function takeRead(endpoint: string, id = VENUE_ID): ReadRequest {
    const index = reads.findIndex((read) => read.path === `${endpoint}?venueId=${encodeURIComponent(id)}`);
    if (index < 0) throw new Error(`No pending ${endpoint} read for ${id}`);
    return reads.splice(index, 1)[0]!;
  }

  async function answer(read: ReadRequest, rows: DropWithPhotos[] = []) {
    await act(async () => {
      read.resolve(Response.json({ drops: rows, prices: [], signals: [] }));
    });
  }

  async function fail(read: ReadRequest, kind: "http" | "network" | "json") {
    await act(async () => {
      if (kind === "network") read.reject(new Error("offline"));
      else read.resolve(kind === "http" ? new Response(null, { status: 503 }) : new Response("{"));
    });
  }

  async function loadInitial(rows: DropWithPhotos[] = []) {
    await select(VENUE_ID);
    await answer(takeRead("/api/price-submit"));
    await answer(takeRead("/api/pint-drops"), rows);
  }

  function output(base = estimated()) {
    const rows = drops.dropsByVenueId.get(VENUE_ID) ?? [];
    const signal = drops.venueSignals.get(VENUE_ID);
    const lane = venuePriceLane(
      base, signal?.latestContributorPrice, venueSourcedPrice(base), venueBundlePrices(base),
      dropLaneInput(signal?.provisionalContributorPrice, signal?.provisionalContributorAt),
      dropLaneInput(signal?.agedContributorPrice, signal?.agedContributorAt),
      splitLaneInput(signal?.disputedPrices, signal?.disputedAt),
    );
    return {
      pending: venuePriceFallbackPending(
        lane, prices.venuePriceStatus.get(VENUE_ID) ?? "idle", drops.venueDropStatus.get(VENUE_ID) ?? "idle",
      ),
      html: renderOverview(rows, base, {
        communityState: prices, dropReadStatus: drops.venueDropStatus.get(VENUE_ID),
      }),
    };
  }

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    reads = [];
    vi.stubGlobal("fetch", vi.fn((input: string) => {
      if (!input.includes("venueId=")) return Promise.resolve(Response.json({ drops: [] }));
      return new Promise<Response>((resolve, reject) => { reads.push({ path: input, resolve, reject }); });
    }));
    container = document.createElement("div");
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => { root.unmount(); });
    vi.unstubAllGlobals();
  });

  it("suppresses the estimate on reselection until the new observed drop arrives", async () => {
    await loadInitial();
    expect(output().pending).toBe(false);
    expect(output().html).toContain("£6.50");
    await select(otherId);
    await answer(takeRead("/api/price-submit", otherId));
    await answer(takeRead("/api/pint-drops", otherId));
    await select(VENUE_ID);
    expect(prices.venuePriceStatus.get(VENUE_ID)).toBe("ready");
    expect(prices.byVenueId.get(VENUE_ID)).toEqual([]);
    expect(output().pending).toBe(true);
    expect(output().html).toContain("Checking prices…");
    expect(output().html).not.toContain("£6.50");
    await answer(takeRead("/api/pint-drops"), [observed()]);
    expect(output().pending).toBe(false);
    expect(output().html).toContain("£4.70");
    expect(output().html).not.toContain("£6.50");
    await act(async () => { drops.refreshVenueDrops(VENUE_ID); });
    expect(output().pending).toBe(false);
    expect(output().html).toContain("£4.70");
    expect(drops.dropsByVenueId.get(VENUE_ID)).toEqual([observed()]);
  });

  it.each(["http", "network", "json"] as const)("settles %s failures without losing held observations or claiming an empty pub", async (kind) => {
    await loadInitial([observed()]);
    await act(async () => { drops.refreshVenueDrops(VENUE_ID); });
    expect(output().pending).toBe(false);
    expect(output().html).toContain("£4.70");
    await fail(takeRead("/api/pint-drops"), kind);
    expect(drops.venueDropStatus.get(VENUE_ID)).toBe("unavailable");
    expect(drops.dropsByVenueId.get(VENUE_ID)).toEqual([observed()]);
    expect(output().html).toContain("£4.70");

    await act(async () => { drops.refreshVenueDrops(VENUE_ID); });
    await answer(takeRead("/api/pint-drops"));
    expect(drops.dropsByVenueId.get(VENUE_ID)).toEqual([]);
    await act(async () => { drops.refreshVenueDrops(VENUE_ID); });
    expect(output().pending).toBe(true);
    expect(output(venue()).html).toContain("Checking prices…");
    expect(output(venue()).html).not.toContain(firstDropNudgeCopy(VENUE_ID).line);
    await fail(takeRead("/api/pint-drops"), kind);
    expect(output().pending).toBe(false);
    expect(output().html).toContain("£6.50");
    expect(output(venue()).html).toContain("could not read");
    expect(output(venue()).html).not.toContain(firstDropNudgeCopy(VENUE_ID).line);
  });

  it.each(["older-first", "newer-first"] as const)("ignores superseded success and failure responses when completion is %s", async (order) => {
    await loadInitial();
    for (const outcome of ["success", "failure"] as const) {
      let cancelOlder: () => void = noop;
      await act(async () => { cancelOlder = drops.refreshVenueDrops(VENUE_ID); });
      const older = takeRead("/api/pint-drops");
      await act(async () => { drops.refreshVenueDrops(VENUE_ID); });
      const newer = takeRead("/api/pint-drops");
      const finishOlder = () => outcome === "success" ? answer(older) : fail(older, "network");
      if (order === "older-first") {
        await finishOlder();
        expect(drops.venueDropStatus.get(VENUE_ID)).toBe("idle");
        cancelOlder();
        await answer(newer, [observed()]);
      } else {
        await answer(newer, [observed()]);
        await finishOlder();
        cancelOlder();
      }
      expect(drops.venueDropStatus.get(VENUE_ID)).toBe("ready");
      expect(drops.dropsByVenueId.get(VENUE_ID)).toEqual([observed()]);
    }
  });

  it("ignores canceled and superseded reads across quick venue reselection", async () => {
    await loadInitial();
    await act(async () => { drops.refreshVenueDrops(VENUE_ID); });
    const older = takeRead("/api/pint-drops");
    await select(otherId);
    const other = takeRead("/api/pint-drops", otherId);
    await select(VENUE_ID);
    const current = takeRead("/api/pint-drops");
    await answer(older, [observed()]);
    await answer(other, [{ ...observed(), venueId: otherId }]);
    expect(drops.venueDropStatus.get(VENUE_ID)).toBe("idle");
    expect(drops.dropsByVenueId.get(VENUE_ID)).toEqual([]);
    expect(drops.dropsByVenueId.get(otherId)).toBeUndefined();
    await answer(current, [observed()]);
    expect(output().html).toContain("£4.70");
  });

  it("cancels only its own request and settles concurrent reads for different venues", async () => {
    await loadInitial();
    let cancel: () => void = noop;
    await act(async () => { cancel = drops.refreshVenueDrops(VENUE_ID); });
    const canceled = takeRead("/api/pint-drops");
    cancel();
    await act(async () => {
      drops.refreshVenueDrops(otherId);
      drops.refreshVenueDrops(VENUE_ID);
    });
    const other = takeRead("/api/pint-drops", otherId);
    const current = takeRead("/api/pint-drops");
    await answer(canceled, [observed()]);
    await answer(other, [{ ...observed(), venueId: otherId }]);
    expect(drops.venueDropStatus.get(VENUE_ID)).toBe("idle");
    expect(drops.dropsByVenueId.get(VENUE_ID)).toEqual([]);
    expect(drops.venueDropStatus.get(otherId)).toBe("ready");
    expect(drops.dropsByVenueId.get(otherId)).toEqual([{ ...observed(), venueId: otherId }]);
    await answer(current, [observed()]);
    expect(output().html).toContain("£4.70");
  });
});

/** Every price action the battle test counted, none of which may return. */
const RETIRED_DOORS = [
  "Or leave a Pint Drop",
  "Add a price at",
  drinkLaneLogActionLabel("beer"),
  ">Log it<",
  "vpsubQuickChip",
];

describe("overviewPriceDoor: one door per trust state", () => {
  it("names a door for every state in the closed set, and only the second-drinker states ask one", () => {
    expect(Object.keys(OVERVIEW_PRICE_DOOR_KIND).sort()).toEqual([...PINT_TRUST_STATES].sort());
    expect(OVERVIEW_PRICE_DOOR_KIND).toEqual({
      confirmed: "log",
      corroborated: "log",
      disputed: "choose",
      "logged-once": "confirm",
      "aged-out": "confirm",
      none: "log",
    });
    // The states that ASK a second drinker something - one figure to confirm or
    // a choice between the recorded ones - are exactly the second-drinker
    // states, so the two tables (this one and lib/pintDropSecondDrinker.ts)
    // cannot drift apart.
    for (const state of PINT_TRUST_STATES) {
      const asks =
        OVERVIEW_PRICE_DOOR_KIND[state] === "confirm" ||
        OVERVIEW_PRICE_DOOR_KIND[state] === "choose";
      expect(asks, state).toBe(secondDrinkerDoorOffered(state));
    }
  });

  it("asks WHICH over a split, offering every recorded figure and naming none of them the answer", () => {
    const split: VenuePriceLane = {
      lane: "disputed",
      split: { prices: [4.5, 4.7], reporters: 2 },
      observedAt: null,
    };
    expect(overviewPriceDoor("disputed", split)).toEqual({
      kind: "choose",
      label: CHOOSE_PRICE_DOOR_LABEL,
      prices: [4.5, 4.7],
    });
    const html = renderOverview(FIXTURES.disputed());
    expect(html).toContain(CHOOSE_PRICE_DOOR_LABEL);
    expect(html).toContain('data-price-door="choose"');
    expect(html).toContain('data-price-gbp="4.50"');
    expect(html).toContain('data-price-gbp="4.70"');
    // "Still £4.70?" named one of two answers and called the other a
    // correction. It may never stand over a split again.
    expect(html).not.toContain(confirmPintActionLabel(4.7));
    expect(html).not.toContain(confirmPintActionLabel(4.5));
  });

  it("words the confirm door over the lane's own figure (the #1492 door, kept as the primary)", () => {
    const provisional: VenuePriceLane = { lane: "provisional", provisionalPrice: 4.5, observedAt: null };
    const aged: VenuePriceLane = { lane: "aged", agedPrice: 3.8, observedAt: null };
    expect(overviewPriceDoor("logged-once", provisional)).toEqual({
      kind: "confirm",
      label: confirmPintActionLabel(4.5),
      priceGbp: 4.5,
    });
    expect(overviewPriceDoor("aged-out", aged)).toEqual({
      kind: "confirm",
      label: "Still £3.80?",
      priceGbp: 3.8,
    });
  });

  it("offers the log door on every other state and on every non-drop lane, with one label", () => {
    const log = { kind: "log", label: LOG_PRICE_DOOR_LABEL };
    expect(overviewPriceDoor("confirmed", { lane: "contributor", contributorPrice: 4.5 })).toEqual(log);
    expect(overviewPriceDoor("corroborated", { lane: "contributor", contributorPrice: 4.5 })).toEqual(log);
    expect(overviewPriceDoor("none", null)).toEqual(log);
    expect(overviewPriceDoor(null, null)).toEqual(log);
    expect(overviewPriceDoor(null, { lane: "baseline", standing: "none", publisher: null, observedOn: null, cheapestPrice: 6.2 })).toEqual(log);
    expect(
      overviewPriceDoor(null, {
        lane: "listed",
        listed: { priceGbp: 6, sourceUrl: "https://pub.example/menu", observedAt: daysAgo(1) },
      }),
    ).toEqual(log);
    expect(
      overviewPriceDoor(null, {
        lane: "estimate",
        estimate: { priceGbp: 6.5, computedAt: daysAgo(1), basis: "regional_baseline:camden" },
      } as VenuePriceLane),
    ).toEqual(log);
    expect(LOG_PRICE_DOOR_LABEL).toBe("Log tonight's price");
    expect(firstDropNudgeCopy(VENUE_ID).cta).toBe(LOG_PRICE_DOOR_LABEL);
  });

  it("offers no door over an anchor lane, because a cocktail or a course is not a pint", () => {
    expect(
      overviewPriceDoor(null, { lane: "anchor", anchorLabel: "Negroni", cheapestPrice: 11 }),
    ).toBeNull();
  });
});

describe("the rendered Overview carries exactly one price door", () => {
  it.each(PINT_TRUST_STATES)("%s: one door, none of the retired ones", (state) => {
    const html = renderOverview(FIXTURES[state]());
    expect(doorCount(html), `${state}: door count`).toBe(1);
    expect(html).toContain(`data-price-door="${OVERVIEW_PRICE_DOOR_KIND[state]}"`);
    for (const retired of RETIRED_DOORS) {
      expect(html, `${state}: ${retired}`).not.toContain(retired);
    }
  });

  it("the confirm door keeps its #1492 words and accessible name", () => {
    const html = renderOverview([drop()]);
    expect(html).toContain('data-testid="confirm-pint-cta"');
    expect(html).toContain(confirmPintActionLabel(4.5));
    expect(html).toContain(confirmPintActionName(4.5, "The Sir Christopher Hatton"));
    expect(html).not.toContain(LOG_PRICE_DOOR_LABEL);
  });

  it("the log door names the pub for a screen reader", () => {
    const html = renderOverview([]);
    expect(html).toContain('data-testid="log-price-cta"');
    // renderToStaticMarkup escapes the apostrophe in the attribute.
    expect(html).toContain(
      `aria-label="${LOG_PRICE_DOOR_LABEL.replace("'", "&#x27;")} at The Sir Christopher Hatton"`,
    );
    expect(html).toContain(firstDropNudgeCopy(VENUE_ID).line);
  });

  it("a listed-only and a baseline-only pub each get the one log door beside their figure", () => {
    const listed = venue({
      bundlePrices: {
        listed: { priceGbp: 6, sourceUrl: "https://pub.example/menu", observedAt: daysAgo(1) },
      },
    } as Partial<Venue>);
    const listedHtml = renderOverview([], listed);
    expect(listedHtml).toContain("Published price");
    expect(doorCount(listedHtml)).toBe(1);
    expect(listedHtml).toContain('data-price-door="log"');

    const baselineHtml = renderOverview([], venue({ cheapestPrice: 6.2 }));
    // The fixture's baseline carries no publisher, so it cannot claim a
    // listing and says what it really is (captain 6 Sep 2026). "Baseline on
    // record" was our word, not the reader's, and may not come back.
    expect(baselineHtml).toContain(BASELINE_NO_PUBLISHER_CAPTION);
    expect(baselineHtml).not.toContain("Baseline on record");
    expect(doorCount(baselineHtml)).toBe(1);
    expect(baselineHtml).toContain('data-price-door="log"');
  });

  it("a sheet handed no confirm handler still offers one door, the log door", () => {
    const html = renderOverview([drop()], venue(), { withConfirm: false });
    expect(doorCount(html)).toBe(1);
    expect(html).toContain('data-price-door="log"');
    expect(html).not.toContain('data-testid="confirm-pint-cta"');
  });

  it("does not wait for a pub price read on a recordless café", () => {
    const html = renderOverview([], venue({ kind: "cafe" } as Partial<Venue>), { priceReadStatus: "idle" });
    expect(html).not.toContain("Checking prices");
    expect(doorCount(html)).toBe(0);
  });

  it("a venue that is not a pub carries no door and no composer", () => {
    const bar = venue({ kind: "bar", anchorLabel: "Negroni", cheapestPrice: 11 } as Partial<Venue>);
    const html = renderOverview([], bar);
    expect(doorCount(html)).toBe(0);
    expect(html).not.toContain("venuePriceSubmit");
  });
});

describe("the composer is folded until the door opens it", () => {
  it("renders no form, no Log it and no chips before the door is taken", () => {
    const html = renderOverview([]);
    expect(html).not.toContain("venuePriceSubmit");
    expect(html).not.toContain(">Log it<");
    expect(html).not.toContain("vpsubQuickChip");
  });

  it("the door opens the form and folds away, so the form is then the one price action", () => {
    const html = renderOverview([], venue(), { priceFocusRequest: 1 });
    expect(html).toContain("venuePriceSubmit");
    expect(html).toContain(">Log it<");
    expect(doorCount(html)).toBe(0);
  });

  it("the sign-in gate counts as open, so the door and the gate never stand together", () => {
    const html = renderOverview([], venue(), { priceSignInRequested: true });
    expect(doorCount(html)).toBe(0);
  });

  it("is one pure reading of the three flags the sheet owns", () => {
    expect(overviewComposerOpen({ focusRequest: 0, signInRequested: false, missionPresent: false })).toBe(false);
    expect(overviewComposerOpen({ focusRequest: 1, signInRequested: false, missionPresent: false })).toBe(true);
    expect(overviewComposerOpen({ focusRequest: 0, signInRequested: true, missionPresent: false })).toBe(true);
    expect(overviewComposerOpen({ focusRequest: 0, signInRequested: false, missionPresent: true })).toBe(true);
    // The latch: a mission opens the composer and a logged price takes the
    // mission away (L02), so the form has to stay for the receipt it earned.
    expect(overviewComposerOpen({
      focusRequest: 0,
      signInRequested: false,
      missionPresent: false,
      priceLogged: true,
    })).toBe(true);
  });

  it("the prices-by-drink invite folds whenever the price area owns the door or the form is open", () => {
    expect(drinkInviteOwnedByPriceArea(true, true, false)).toBe(true);
    expect(drinkInviteOwnedByPriceArea(false, true, true)).toBe(true);
    // Under a drink lens the price area is hidden, so the block keeps the lane's door.
    expect(drinkInviteOwnedByPriceArea(false, true, false)).toBe(false);
    // A bar's price area renders no door, so its block keeps its own line.
    expect(drinkInviteOwnedByPriceArea(true, false, false)).toBe(false);
  });
});

describe("price precedence in the rendered Overview", () => {
  const sourced = {
    provenance: "sourced" as const, sourceLabel: "pub.example",
    sourceUrl: "https://pub.example/prices", observedAt: daysAgo(1),
  };
  const listed = { priceGbp: 6, sourceUrl: "https://pub.example/menu", observedAt: daysAgo(1) };
  const estimate = { priceGbp: 6.5, computedAt: daysAgo(1), basis: "regional_baseline:camden", sampleSize: 8 };
  const sourcedVenue = (): PricedVenue => ({
    ...venue({ cheapestPrice: 6.2, bundlePrices: { listed, estimate } } as Partial<Venue>),
    sourcedPrice: sourced,
  });

  it.each([
    { name: "anchor", base: venue({ kind: "restaurant", anchorLabel: "Negroni", cheapestPrice: 11 }), drops: [], figure: "£11.00", caption: "Not a pint price.", door: null, source: null },
    { name: "contributor over sourced, listed and baseline", base: sourcedVenue(), drops: confirmedPair(), figure: "£4.50", caption: "Latest Pint Drop price", door: "log", source: null },
    { name: "sourced over listed, provisional and baseline", base: sourcedVenue(), drops: [drop()], figure: "£6.20", caption: "Sourced price", door: "log", source: sourced.sourceUrl },
    { name: "listed over provisional and baseline", base: venue({ cheapestPrice: 6.2, bundlePrices: { listed, estimate } } as Partial<Venue>), drops: [drop()], figure: "£6.00", caption: "Published price", door: "log", source: listed.sourceUrl },
    { name: "provisional over baseline", base: venue({ cheapestPrice: 6.2 }), drops: [drop()], figure: "£4.50", caption: "Logged once, needs a second drinker", door: "confirm", source: null },
    { name: "disputed over baseline", base: venue({ cheapestPrice: 6.2 }), drops: FIXTURES.disputed(), figure: "£4.50 and £4.70", caption: "Two drinkers, two prices", door: "choose", source: null },
    { name: "baseline over aged and estimate", base: venue({ cheapestPrice: 6.2, bundlePrices: { estimate } } as Partial<Venue>), drops: FIXTURES["aged-out"](), figure: "£6.20", caption: "Price on record", door: "log", source: null },
    { name: "aged over estimate", base: venue({ bundlePrices: { estimate } } as Partial<Venue>), drops: FIXTURES["aged-out"](), figure: "£4.50", caption: "needs a fresh drinker", door: "confirm", source: null },
    { name: "estimate", base: venue({ bundlePrices: { estimate } } as Partial<Venue>), drops: [], figure: "£6.50", caption: "est.", door: "log", source: null },
  ])("prints $name with its figure, provenance and single door", ({ base, drops, figure, caption, door, source }) => {
    const view = document.createElement("div");
    view.innerHTML = renderOverview(drops, base);
    const summary = view.querySelector(".contributorPrice");
    expect(summary).not.toBeNull();
    expect(summary?.textContent).toContain(figure);
    expect(summary?.textContent).toContain(caption);
    expect(view.querySelector(".firstDropNudge")).toBeNull();
    expect(summary?.textContent).not.toContain("No price");
    expect(view.querySelectorAll("[data-price-door]")).toHaveLength(door === null ? 0 : 1);
    expect(view.querySelector("[data-price-door]")?.getAttribute("data-price-door") ?? null).toBe(door);
    if (source !== null) expect(summary?.querySelector("a.priceSourceLink")?.getAttribute("href")).toBe(source);
  });

  it.each(["ready", "unavailable", "idle"] as const)("words an absent price honestly after a %s drop read", (dropReadStatus) => {
    const view = document.createElement("div");
    view.innerHTML = renderOverview([], venue(), { dropReadStatus });
    if (dropReadStatus === "ready") {
      expect(view.querySelector(".firstDropNudgeLine")?.textContent).toBe(firstDropNudgeCopy(VENUE_ID).line);
      expect(view.querySelectorAll("[data-price-door]")).toHaveLength(1);
    } else if (dropReadStatus === "unavailable") {
      expect(view.querySelector(".firstDropNudgeLine")?.textContent).toBe("We could not read this pub’s logged prices.");
      expect(view.textContent).not.toContain(firstDropNudgeCopy(VENUE_ID).line);
      expect(view.querySelectorAll("[data-price-door]")).toHaveLength(1);
    } else {
      expect(view.textContent).toContain("Checking prices");
      expect(view.querySelector(".firstDropNudge")).toBeNull();
      expect(view.querySelectorAll("[data-price-door]")).toHaveLength(0);
    }
  });
});

describe("price actions beside the Overview", () => {
  it.each([
    { mode: "suggest" as const, inCrawl: false, accept: false, names: ["Share"] },
    { mode: "suggest" as const, inCrawl: false, accept: true, names: ["Make it Stop 1", "Share"] },
    { mode: "build" as const, inCrawl: false, accept: true, names: ["Make it Stop 1", "Crawl", "Share"] },
    { mode: "build" as const, inCrawl: true, accept: true, names: ["Make it Stop 1", "Remove", "Share"] },
  ])("the sticky bar offers only venue actions in $mode, inCrawl=$inCrawl, accept=$accept", ({ mode, inCrawl, accept, names }) => {
    const view = document.createElement("div");
    view.innerHTML = renderToStaticMarkup(createElement(VenueStickyBar, {
      venue: venue(), mode, inCrawl, onToggleStop: noop,
      onAcceptStop1: accept ? noop : undefined,
      shareVenue: async () => {}, currentShareFeedback: null,
    }));
    expect(Array.from(view.querySelectorAll("button"), (button) => button.textContent?.trim())).toEqual(names);
    expect(view.querySelectorAll(".venueSheetStickyPrimary, [data-price-door]")).toHaveLength(0);
  });

  it("the first-drop nudge adds no price action beside the supplied door", () => {
    const view = document.createElement("div");
    view.innerHTML = renderToStaticMarkup(createElement(FirstDropNudge, { venueId: VENUE_ID }));
    expect(view.querySelectorAll("button, a, [data-price-door]")).toHaveLength(0);
    expect(view.textContent).toContain(firstDropNudgeCopy(VENUE_ID).line);
    view.innerHTML = renderToStaticMarkup(createElement(FirstDropNudge, { venueId: VENUE_ID },
      createElement("button", { "data-price-door": "log" }, "Log tonight's price"),
    ));
    expect(view.querySelectorAll("button, a")).toHaveLength(1);
    expect(view.querySelector("[data-price-door]")?.textContent).toBe("Log tonight's price");
    expect(view.textContent).not.toContain("Or leave a Pint Drop");
  });
});
