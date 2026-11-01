// @vitest-environment jsdom

// A HISTORICAL PRICE IS HISTORY. IT MAY NEVER ANSWER "WHAT DOES A PINT COST HERE NOW".
//
// public/data/price_history/london.json holds dated, sourced prices from years
// gone by: what a pint at a pub cost in 2013, cited to an archived page. That
// figure is the most emotionally loaded number on the product, and it is also
// the easiest one to get wrong: let it leak one seam and a 2013 price paints a
// pin, wins a cheapest-pint bucket, or lands in the Pint Index as this month's
// evidence.
//
// So the separation is a fence, not a convention, and it has three parts:
//
//   1. IDENTITY  — every row names a venue the app actually ships, carries a
//      real past day, an http(s) source, and a price in pint range.
//   2. AUTHORITY: loaded history prints as history and as nothing else. The
//      venue sheet sets it beside today's figure without making it one, the
//      landing ranks by today's price, and every reader of today's price
//      (pins, bands, sourced merges, community submissions, the Pint Index)
//      refuses a historical row or answers exactly as it does without one.
//   3. DATA      — no historical figure is written into any current-price feed,
//      and the freshness registry does not carry this file as a price feed.

import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { priceBucket, pubsToGeoJSON } from "@/components/map/canvas/geojson";
import VenueOverviewTab from "@/components/map/inspector/VenueOverviewTab";
import type { CommunityPricesState } from "@/components/map/useCommunityPrices";
import registry from "@/data/freshness_registry.json";
import { validateCommunityPrice } from "@/lib/communityPrice";
import { parseDrinkPriceUpdates } from "@/lib/drinkPriceUpdates";
import { parseFoodPriceUpdates } from "@/lib/foodPriceUpdates";
import { buildLandingAnchorRail, buildLandingArchiveIndex, buildLandingPubCard } from "@/lib/landingPubCard";
import { LONDON_BOROUGH_CLASSIFIER_VERSION } from "@/lib/londonBoroughPoint.mjs";
import { buildLeagueTable, validatePintIndexSnapshot, type PintIndexSnapshot } from "@/lib/pintIndex";
import {
  formatObservedDay,
  formatObservedMonth,
  groupPriceHistoryByVenue,
  isValidObservedOn,
  isValidPriceHistoryObservation,
  parsePriceHistory,
  sameComparisonItem,
  venuePriceArc,
  type PriceComparisonItem,
  type PriceHistoryObservation,
} from "@/lib/priceHistory";
import { loadPriceHistory, resetPriceHistoryLoader } from "@/lib/priceHistoryLoader";
import { PRICE_NOT_COMPARED_LINE } from "@/lib/priceMovementLine";
import { mergePriceUpdates, parsePriceUpdates } from "@/lib/priceUpdates";
import { rowsFromSlimPayload } from "@/lib/slimPayload";
import type { Venue } from "@/lib/venues";

const ROOT = resolve(__dirname, "..");
const HISTORY_FILE = join(ROOT, "public/data/price_history/london.json");

const shipped = parsePriceHistory(
  JSON.parse(readFileSync(HISTORY_FILE, "utf8")) as unknown,
);
const rawShipped = JSON.parse(readFileSync(HISTORY_FILE, "utf8")) as {
  version: number;
  observations: unknown[];
};

function slimVenueIds(): Set<string> {
  const dir = join(ROOT, "public/data");
  const ids = new Set<string>();
  for (const file of readdirSync(dir)) {
    if (!/^venues_slim\.(?!manifest)/.test(file) && file !== "venues_slim.json") continue;
    const parsed = JSON.parse(readFileSync(join(dir, file), "utf8")) as unknown;
    const rows = rowsFromSlimPayload(parsed) ?? [];
    for (const venue of rows as Array<{ id?: unknown }>) {
      if (typeof venue.id === "string") ids.add(venue.id);
    }
  }
  return ids;
}

function slimVenuesWithCurrentPrice(): Set<string> {
  const dir = join(ROOT, "public/data");
  const ids = new Set<string>();
  for (const file of readdirSync(dir)) {
    if (!/^venues_slim\.(?!manifest)/.test(file) && file !== "venues_slim.json") continue;
    const parsed = JSON.parse(readFileSync(join(dir, file), "utf8")) as unknown;
    const rows = rowsFromSlimPayload(parsed) ?? [];
    for (const venue of rows as Array<{ id?: unknown; cheapestPrice?: unknown }>) {
      if (typeof venue.id === "string" && typeof venue.cheapestPrice === "number") ids.add(venue.id);
    }
  }
  return ids;
}

const NOW = Date.UTC(2026, 9, 17, 12);
const HISTORY_PATH = "/data/price_history/london.json";
const noop = () => {};

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  resetPriceHistoryLoader();
  vi.unstubAllGlobals();
});

function historyBody(rows: Array<{ venueId: string; priceGbp: number; observedOn: string }>) {
  return {
    version: 1,
    generatedAt: "2026-07-27",
    observations: rows.map((row) => ({
      ...row,
      venueName: "Test",
      source: {
        label: "beerintheevening.com",
        url: `https://www.beerintheevening.com/pubs/${row.venueId}`,
        licence: "quoted with attribution",
      },
    })),
  };
}

function stubHistory(body: unknown): void {
  resetPriceHistoryLoader();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) =>
      String(input) === HISTORY_PATH && body !== null
        ? new Response(JSON.stringify(body), { status: 200 })
        : new Response("{}", { status: 503 }),
    ),
  );
}

function currentVenue(id: string, name: string, over: Partial<Venue> = {}): Venue {
  return {
    id,
    name,
    address: "1 Test Street",
    latitude: 51.5,
    longitude: -0.12,
    primaryBorough: "Camden",
    visibleBoroughs: ["Camden"],
    prices: [],
    cheapestPrice: 5.4,
    cheapestPint: "Lager",
    averagePrice: 5.4,
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
    zone: 2,
    ...over,
  };
}

function todayVenues(): Venue[] {
  return [
    currentVenue("venue-dear", "Dear Arms", { cheapestPrice: 6.5, averagePrice: 6.5 }),
    currentVenue("venue-cheap", "Cheap Tavern", { cheapestPrice: 3.2, averagePrice: 3.2 }),
    currentVenue("venue-unpriced", "Quiet Inn", { cheapestPrice: null, averagePrice: null }),
  ];
}

const todayHistory = historyBody([
  { venueId: "venue-dear", priceGbp: 2, observedOn: "2012-01-01" },
  { venueId: "venue-cheap", priceGbp: 4.5, observedOn: "2016-01-01" },
  { venueId: "venue-unpriced", priceGbp: 1.5, observedOn: "2011-01-01" },
]);

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
    submit: async () => ({
      ok: true,
      attribution: { status: "anonymous" },
      price: null,
      pintTrust: null,
      confirmationOutcome: null,
    }),
    submitVenueSignal: async () => ({ ok: true }),
    submitting: false,
    reportPrice: noop,
    reportedIds: new Set(),
  };
}

async function showOverview(venue: Venue, history: unknown): Promise<HTMLElement> {
  stubHistory(history);
  const container = document.createElement("div");
  const root = createRoot(container);
  roots.push(root);
  await act(async () => {
    root.render(
      createElement(VenueOverviewTab, {
        venue,
        tab: "overview",
        onOpenVisitReports: noop,
        cityId: "london",
        latestContributorPrice: null,
        dropReadStatus: "ready",
        communityPrices: communityPrices(venue.id),
        experienceLens: "all",
        presenceState: "idle",
        markPresenceHere: noop,
        userLocation: null,
        locationRequestStatus: "idle",
        onRequestLocation: noop,
        onClearLocation: noop,
        onLogTonightPrice: noop,
        priceEntryAllowed: false,
        priceSignInRequested: false,
        priceAuthLoading: false,
        priceFocusRequest: 0,
      }),
    );
  });
  for (let i = 0; i < 6; i += 1) await act(async () => Promise.resolve());
  return container;
}

function pintIndexEdition(): PintIndexSnapshot {
  return {
    schemaVersion: 1,
    snapshotId: "history-fence-v1",
    status: "published",
    generatedAt: "2026-07-16T12:00:00.000Z",
    observationWindow: { start: "2026-07-01T00:00:00.000Z", end: "2026-07-15T23:59:59.000Z" },
    classification: {
      version: LONDON_BOROUGH_CLASSIFIER_VERSION,
      method: "point_in_polygon",
      sourceArtifact: "data/london_boroughs_simplified.json",
      licence: "OGL v3",
    },
    sources: [
      {
        id: "community-1",
        kind: "confirmed_pint_drop",
        publisher: "PUBMAXX contributor",
        sourceUrl: "https://pubmaxxing.com/evidence/1",
        licence: null,
        confirmationId: "drop-confirmation-1",
        reviewState: "confirmed",
      },
    ],
    observations: [
      { venueId: "a", pubName: "Cheap A", boroughCode: "camden", boroughName: "Camden", pricePence: 580, observedAt: "2026-07-10T12:00:00.000Z", sourceId: "community-1" },
      { venueId: "b", pubName: "Cheap B", boroughCode: "camden", boroughName: "Camden", pricePence: 640, observedAt: "2026-07-11T12:00:00.000Z", sourceId: "community-1" },
    ],
    excluded: [],
  };
}

describe("price archaeology: identity", () => {
  it("ships a usable, non-trivial set", () => {
    expect(rawShipped.version).toBe(1);
    // Every raw row survives parsing: a row this file drops is a row a reader
    // would never see, and a silent drop is how a set rots.
    expect(shipped.length).toBe(rawShipped.observations.length);
    expect(shipped.length).toBeGreaterThanOrEqual(60);
    expect(new Set(shipped.map((o) => o.venueId)).size).toBeGreaterThanOrEqual(60);
  });

  it("is described by a README that counts the shipped file", () => {
    // The yield figures are the argument for continuing this stream, so a
    // reader has to be able to trust them. They drifted once already, when two
    // rows were dropped in review after the numbers had been written down, so
    // the prose is checked against the data rather than against memory.
    const readme = readFileSync(join(ROOT, "public/data/price_history/README.md"), "utf8");
    const venueIds = new Set(shipped.map((o) => o.venueId));
    const priced = slimVenuesWithCurrentPrice();
    const withCurrentPrice = [...venueIds].filter((id) => priced.has(id)).length;
    const years = shipped.map((o) => o.observedOn.slice(0, 4)).sort();

    expect(readme).toContain(
      `**${shipped.length} observations across ${venueIds.size} venues, ${years[0]} to ${years[years.length - 1]}**`,
    );
    expect(readme).toContain(`**${withCurrentPrice} of those\n  venues also carry a current price**`);
    expect(readme).toContain(`${venueIds.size} produced usable evidence`);
  });

  it("names venues the app actually ships", () => {
    const ids = slimVenueIds();
    const strangers = [...new Set(shipped.map((o) => o.venueId))].filter((id) => !ids.has(id));
    expect(strangers).toEqual([]);
  });

  it("carries a source URL and a past day on every row", () => {
    const now = Date.now();
    for (const row of shipped) {
      expect(isValidPriceHistoryObservation(row, now)).toBe(true);
      expect(row.source.url.startsWith("https://")).toBe(true);
      expect(row.source.label.length).toBeGreaterThan(0);
      expect(row.source.licence.length).toBeGreaterThan(0);
      expect(Date.parse(`${row.observedOn}T00:00:00.000Z`)).toBeLessThan(now);
    }
  });

  it("holds prices in pint range, and none of them is today's", () => {
    const today = new Date().toISOString().slice(0, 10);
    for (const row of shipped) {
      expect(row.priceGbp).toBeGreaterThan(0.5);
      expect(row.priceGbp).toBeLessThan(15);
      expect(row.observedOn < today).toBe(true);
    }
  });

  it("holds at most one figure per venue per day", () => {
    const seen = new Set<string>();
    for (const row of shipped) {
      const key = `${row.venueId}|${row.observedOn}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it("attributes one archived page to one pub", () => {
    // The inverse of the rule above, and the one an import gets wrong quietly:
    // a source page is evidence about ONE pub, so citing it for two venue ids
    // ships the same dated fact twice and inflates the set. The only accepted
    // exceptions are venue ids the app's own index holds twice for a single
    // pub, where both records can legitimately show the same history.
    const DUPLICATE_INDEX_RECORDS: Array<{ reason: string; venueIds: string[] }> = [
      {
        reason: "Horniman at Hays: three index records for the one Hay's Galleria pub.",
        venueIds: ["venue-2txloa", "venue-7qifhm", "venue-aihlwx"],
      },
      {
        reason: "Eastbrook, Dagenham: two index records, 'Eastbrook' and 'The Eastbrook'.",
        venueIds: ["venue-16nj2fe", "venue-cn9acj"],
      },
    ];
    const byUrl = new Map<string, Set<string>>();
    for (const row of shipped) {
      const ids = byUrl.get(row.source.url) ?? new Set<string>();
      ids.add(row.venueId);
      byUrl.set(row.source.url, ids);
    }
    for (const [url, ids] of byUrl) {
      if (ids.size === 1) continue;
      const allowed = DUPLICATE_INDEX_RECORDS.find((entry) =>
        [...ids].every((id) => entry.venueIds.includes(id)),
      );
      expect(
        allowed,
        `${url} is cited for ${[...ids].sort().join(", ")}: one archived page is evidence about one pub, so either the identity is wrong or these ids are a documented duplicate index record`,
      ).toBeTruthy();
    }
  });
});

describe("price archaeology: the venue sheet", () => {
  const PUB_ID = "venue-moon";
  const history = historyBody([{ venueId: PUB_ID, priceGbp: 2.89, observedOn: "2013-04-24" }]);
  const elsewhere = historyBody([{ venueId: "venue-elsewhere", priceGbp: 2.89, observedOn: "2013-04-24" }]);
  const pub = () => currentVenue(PUB_ID, "The Moon on the Hill");

  it("prints a pub's dated pint beside today's figure without becoming it", async () => {
    const view = await showOverview(pub(), history);
    const block = view.querySelector(".venuePriceThen");
    expect(block?.querySelector(".vptThen")?.textContent).toBe("£2.89");
    expect(block?.querySelector(".vptNow")?.textContent).toBe("£5.40");
    expect(block?.textContent).toContain("April 2013.");
    expect(block?.querySelector(".vptSource a")?.getAttribute("href")).toBe(
      "https://www.beerintheevening.com/pubs/venue-moon",
    );
    expect(block?.querySelector(".vptSource")?.textContent).toBe("beerintheevening.com, 24 April 2013");
    expect(block?.querySelector(".vptMovement")).toBeNull();
    expect(block?.textContent).toContain(PRICE_NOT_COMPARED_LINE);
    const summary = view.querySelector(".contributorPrice")?.textContent ?? "";
    expect(summary).toContain("£5.40");
    expect(summary).not.toContain("£2.89");
  });

  it("reads today's figure the same with no history row or no readable file, and prints no then block", async () => {
    const withHistory = await showOverview(pub(), history);
    const today = withHistory.querySelector(".contributorPrice")?.textContent;
    expect(today).toContain("£5.40");
    for (const body of [elsewhere, null]) {
      const view = await showOverview(pub(), body);
      expect(view.querySelector(".venuePriceThen")).toBeNull();
      expect(view.textContent).not.toContain("£2.89");
      expect(view.querySelector(".contributorPrice")?.textContent).toBe(today);
    }
  });

  it("prints the dated pint alone where today's price is unknown", async () => {
    const view = await showOverview(
      currentVenue(PUB_ID, "The Moon on the Hill", { cheapestPrice: null, averagePrice: null }),
      history,
    );
    const block = view.querySelector(".venuePriceThen");
    expect(block?.querySelector(".vptThen")?.textContent).toBe("£2.89");
    expect(block?.querySelector(".vptNow")).toBeNull();
    expect(block?.querySelector(".vptNote")).toBeNull();
  });

  it.each(["bar", "food", "restaurant"] as const)(
    "never sets a %s anchor price against the old pint as today's",
    async (kind) => {
      const view = await showOverview(
        currentVenue(PUB_ID, "The Moon on the Hill", {
          kind,
          anchorLabel: "Negroni",
          cheapestPrice: 11,
          averagePrice: 11,
        } as Partial<Venue>),
        history,
      );
      const block = view.querySelector(".venuePriceThen");
      expect(block?.querySelector(".vptThen")?.textContent).toBe("£2.89");
      expect(block?.querySelector(".vptNow")).toBeNull();
      expect(block?.querySelector(".vptNote")).toBeNull();
      expect(block?.textContent).not.toContain("£11.00");
    },
  );

  it("keeps a bar's own anchor figure on the sheet beside the old pint", async () => {
    const view = await showOverview(
      currentVenue(PUB_ID, "The Moon on the Hill", { kind: "bar", anchorLabel: "Negroni", cheapestPrice: 11 } as Partial<Venue>),
      history,
    );
    expect(view.textContent).toContain("Negroni");
    expect(view.textContent).toContain("£11.00");
    expect(view.querySelector(".venuePriceThen .vptThen")?.textContent).toBe("£2.89");
  });

  it("renders only the historical line when there is no price to compare against", () => {
    // History with no current price still ships: the dated fact stands alone
    // and the block degrades to that one sentence rather than disappearing.
    const arc = venuePriceArc(
      [
        {
          venueId: "venue-x",
          venueName: "Hand and Shears",
          priceGbp: 4,
          observedOn: "2013-04-17",
          source: { label: "beerintheevening.com", url: "https://example.com/a", licence: "l" },
        },
      ],
      null,
    );
    expect(arc?.then.priceGbp).toBe(4);
    expect(arc?.nowGbp).toBeNull();
    // No movement line, so no "Up £0.00 in 13 years" against a price we do not have.
    expect(arc?.deltaGbp).toBeNull();
  });
});

describe("price archaeology: the landing pick", () => {
  it("ranks by today's listed price, never by an archived one", () => {
    expect(buildLandingPubCard(todayVenues(), todayHistory, { now: NOW })).toMatchObject({
      id: "venue-cheap",
      priceGbp: 3.2,
      then: { priceGbp: 4.5, observedOn: "2016-01-01" },
    });
  });

  it("never stands an archived figure in for a missing price today", () => {
    const venues = todayVenues();
    expect(buildLandingPubCard(venues.slice(2), todayHistory, { now: NOW })).toBeNull();
    const archive = buildLandingArchiveIndex(venues, todayHistory, NOW);
    expect(Object.keys(archive).sort()).toEqual(["venue-cheap", "venue-dear"]);
    const rail = buildLandingAnchorRail(venues, { id: "venue-cheap", primaryBorough: "Camden" }, archive);
    expect(rail.map((row) => [row.id, row.priceGbp, row.hasThen])).toEqual([["venue-dear", 6.5, true]]);
  });
});

describe("price archaeology: today's price readers", () => {
  it("paints the same pins, bands and labels before and after the history loads", async () => {
    stubHistory(todayHistory);
    const pins = () => pubsToGeoJSON(todayVenues(), new Map(), null).features.map((feature) => feature.properties);
    const before = pins();
    const loaded = await loadPriceHistory();
    expect(loaded.get("venue-unpriced")?.map((row) => row.priceGbp)).toEqual([1.5]);
    const after = pins();
    expect(after).toEqual(before);
    expect(after.map((props) => [props?.id, props?.bucket, props?.priceLabel ?? null])).toEqual([
      ["venue-dear", 2, "£6.50"],
      ["venue-cheap", priceBucket(3.2), "£3.20"],
      ["venue-unpriced", 3, null],
    ]);
  });

  it("refuses a historical row in every sourced pint, drink and food merge", () => {
    for (const body of [todayHistory, todayHistory.observations, rawShipped, rawShipped.observations]) {
      expect(parsePriceUpdates(body, NOW)).toEqual([]);
      expect(parseDrinkPriceUpdates(body, NOW)).toEqual([]);
      expect(parseFoodPriceUpdates(body, NOW)).toEqual([]);
    }
    const merged = mergePriceUpdates(
      todayVenues(),
      parsePriceUpdates(todayHistory.observations, NOW),
      (venue) => venue.id,
    );
    expect(merged.map((venue) => [venue.id, venue.cheapestPrice, venue.sourcedPrice])).toEqual([
      ["venue-dear", 6.5, null],
      ["venue-cheap", 3.2, null],
      ["venue-unpriced", null, null],
    ]);
  });

  it("turns no historical row into a community price", () => {
    for (const row of [...todayHistory.observations, ...shipped]) {
      expect(validateCommunityPrice(row).ok).toBe(false);
    }
  });

  it("admits no historical row to the Pint Index", () => {
    const edition = pintIndexEdition();
    expect(validatePintIndexSnapshot(edition).ok).toBe(true);
    expect(buildLeagueTable(edition).map((row) => [row.name, row.averageGbp])).toEqual([["Camden", 6.1]]);
    for (const row of [todayHistory.observations[0], shipped[0]]) {
      expect(validatePintIndexSnapshot({ ...edition, observations: [...edition.observations, row] }).ok).toBe(false);
    }
    expect(validatePintIndexSnapshot(rawShipped).ok).toBe(false);
  });

  it("exposes nothing a current-price merge could mistake for today's price", () => {
    // Every row is stamped with a calendar day and a source, and carries no
    // "observedAt"/"priceGbp-now" shape the live merges read.
    for (const row of shipped) {
      expect(Object.keys(row).sort()).toEqual(
        expect.arrayContaining(["observedOn", "priceGbp", "source", "venueId", "venueName"]),
      );
      expect(row).not.toHaveProperty("observedAt");
      expect(row).not.toHaveProperty("cheapestPrice");
      expect(row).not.toHaveProperty("priceBand");
    }
  });
});

describe("price archaeology: the data fence", () => {
  it("is absent from the freshness registry", () => {
    const artifacts = registry.datasets
      .map((d) => (d as { artifact?: unknown }).artifact)
      .filter((a): a is string => typeof a === "string");
    expect(artifacts.some((a) => a.includes("price_history"))).toBe(false);
  });

  it("has not been written into the current-price update feeds", () => {
    const feeds = [
      "public/data/price_updates/latest.json",
      "public/data/drink_price_updates/latest.json",
    ];
    for (const feed of feeds) {
      let raw: string;
      try {
        raw = readFileSync(join(ROOT, feed), "utf8");
      } catch {
        continue;
      }
      for (const row of shipped) {
        expect(raw, `${feed} must not cite a historical source`).not.toContain(row.source.url);
      }
    }
  });

  it("has not been written into the published Pint Index editions", () => {
    const dir = join(ROOT, "public/data/pint_index");
    let files: string[];
    try {
      files = readdirSync(dir).filter((f) => f.endsWith(".json"));
    } catch {
      files = [];
    }
    for (const file of files) {
      const raw = readFileSync(join(dir, file), "utf8");
      for (const row of shipped) {
        expect(raw, `${file} must not cite a historical source`).not.toContain(row.source.url);
      }
    }
  });
});

describe("price archaeology: the module", () => {
  const row: PriceHistoryObservation = {
    venueId: "venue-abc",
    venueName: "The Test Arms",
    priceGbp: 2.8,
    observedOn: "2009-06-14",
    source: { label: "example.com", url: "https://example.com/a", licence: "Quoted." },
  };

  it("drops a row with no source, no day, or a day that never happened", () => {
    expect(isValidPriceHistoryObservation(row)).toBe(true);
    expect(isValidPriceHistoryObservation({ ...row, source: undefined })).toBe(false);
    expect(isValidPriceHistoryObservation({ ...row, source: { ...row.source, url: "ftp://x" } })).toBe(false);
    expect(isValidPriceHistoryObservation({ ...row, observedOn: "2009-6-14" })).toBe(false);
    expect(isValidPriceHistoryObservation({ ...row, observedOn: "2009-02-31" })).toBe(false);
    expect(isValidPriceHistoryObservation({ ...row, priceGbp: 0 })).toBe(false);
  });

  it("refuses a day in the future", () => {
    const now = Date.parse("2020-01-01T00:00:00.000Z");
    expect(isValidObservedOn("2019-12-31", now)).toBe(true);
    expect(isValidObservedOn("2020-06-01", now)).toBe(false);
  });

  it("parses either a bare array or the file wrapper, dropping bad rows", () => {
    expect(parsePriceHistory([row, { venueId: "x" }])).toHaveLength(1);
    expect(parsePriceHistory({ observations: [row] })).toHaveLength(1);
    expect(parsePriceHistory(null)).toEqual([]);
  });

  it("builds the arc from the oldest row, and never invents a price for today", () => {
    const older = { ...row, observedOn: "2009-06-14", priceGbp: 2.8 };
    const newer = { ...row, observedOn: "2016-01-02", priceGbp: 4.1 };
    const asOf = Date.parse("2026-07-01T00:00:00.000Z");
    const arc = venuePriceArc([newer, older], 6.2, asOf);
    expect(arc?.then.observedOn).toBe("2009-06-14");
    expect(arc?.nowGbp).toBe(6.2);
    // Neither figure states what it is a price for, so both stand and no
    // movement is said between them.
    expect(arc?.deltaGbp).toBeNull();
    expect(arc?.years).toBe(17);

    const noCurrent = venuePriceArc([older], null, asOf);
    expect(noCurrent?.nowGbp).toBeNull();
    expect(noCurrent?.deltaGbp).toBeNull();

    expect(venuePriceArc([], 6.2, asOf)).toBeNull();
  });

  it("groups by venue, oldest first", () => {
    const other = { ...row, venueId: "venue-def", observedOn: "2011-01-01" };
    const grouped = groupPriceHistoryByVenue([{ ...row, observedOn: "2014-01-01" }, row, other]);
    expect(grouped.get("venue-abc")?.map((o) => o.observedOn)).toEqual(["2009-06-14", "2014-01-01"]);
    expect(grouped.get("venue-def")).toHaveLength(1);
  });

  it("dates a claim to the month on screen and the day in the citation", () => {
    expect(formatObservedMonth("2013-07-14")).toBe("July 2013");
    expect(formatObservedDay("2013-07-14")).toBe("14 July 2013");
    expect(formatObservedMonth("not-a-date")).toBe("not-a-date");
  });
});

describe("price archaeology: then against now", () => {
  // Two true dated prices are not a trend. A movement says ONE thing got
  // dearer or cheaper, so both figures must state the same drink, the same
  // serving and an ordinary price, and nothing less will do.
  const asOf = Date.parse("2026-10-17T00:00:00.000Z");
  const budLight: PriceComparisonItem = { drink: "Bud Light", measure: "pint", terms: "standard" };
  const unstated: PriceHistoryObservation = {
    venueId: "venue-moon",
    venueName: "The Moon on the Hill",
    priceGbp: 2.89,
    observedOn: "2013-04-24",
    source: { label: "beerintheevening.com", url: "https://example.com/moon", licence: "Quoted." },
  };
  const stated: PriceHistoryObservation = { ...unstated, item: budLight };

  it("says the movement when both figures state the same pint at an ordinary price", () => {
    const arc = venuePriceArc([stated], 2.43, asOf, { drink: " bud  LIGHT ", measure: "pint", terms: "standard" });
    expect(arc?.deltaGbp).toBe(-0.46);
    expect(arc?.years).toBe(13);
  });

  it("keeps both figures and says no movement when either side states no item", () => {
    const arcs = [
      venuePriceArc([unstated], 2.43, asOf, budLight),
      venuePriceArc([stated], 2.43, asOf),
      venuePriceArc([unstated], 2.43, asOf),
    ];
    for (const arc of arcs) {
      expect(arc?.then.priceGbp).toBe(2.89);
      expect(arc?.then.observedOn).toBe("2013-04-24");
      expect(arc?.nowGbp).toBe(2.43);
      expect(arc?.deltaGbp).toBeNull();
    }
  });

  it("says no movement for another drink, another serving or a generic name", () => {
    const todays: PriceComparisonItem[] = [
      { drink: "Bud Light Lime", measure: "pint", terms: "standard" },
      { drink: "Budweiser", measure: "pint", terms: "standard" },
      { drink: "Bud Light", measure: "half", terms: "standard" },
    ];
    for (const today of todays) {
      expect(venuePriceArc([stated], 2.43, asOf, today)?.deltaGbp).toBeNull();
    }
    const other: PriceComparisonItem = { drink: "Bud Light", measure: "other", terms: "standard" };
    expect(sameComparisonItem(other, other)).toBe(false);
    const lager: PriceComparisonItem = { drink: "Lager", measure: "pint", terms: "standard" };
    expect(sameComparisonItem(lager, { ...lager, drink: "lager" })).toBe(false);
  });

  it("says no movement against a promotional price or an unstated serving", () => {
    expect(sameComparisonItem(budLight, { drink: "Bud Light", measure: "pint", terms: "happy hour" })).toBe(false);
    expect(sameComparisonItem(budLight, { drink: "Bud Light", terms: "standard" })).toBe(false);
    expect(sameComparisonItem({}, {})).toBe(false);
    expect(sameComparisonItem(null, undefined)).toBe(false);
    expect(sameComparisonItem(budLight, { ...budLight })).toBe(true);
  });

  it("reads an item only where a row states all of it, never out of its words", () => {
    const parsed = parsePriceHistory(
      [
        { ...unstated, drink: "a pint of Bud Light", quote: "£2.89 for a pint of Bud Light." },
        { ...unstated, observedOn: "2014-01-01", item: { drink: "Bud Light", measure: "pint", terms: "promotion" } },
        { ...unstated, observedOn: "2015-01-01", item: budLight },
      ],
      asOf,
    );
    // A row whose item states too little keeps its dated fact and loses only the item.
    expect(parsed).toHaveLength(3);
    expect(parsed.map((row) => row.item ?? null)).toEqual([null, null, budLight]);
  });
});
