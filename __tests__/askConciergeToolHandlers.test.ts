import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ConciergeVenue } from "@/lib/concierge/rank";
import type { CommunityPrice } from "@/lib/communityPrice";
import type { WhatsOnRow } from "@/lib/whatsOn";
import type { DeskVenueRead } from "@/lib/ask/deskVenues.server";
import type { Venue, VenuePrice } from "@/lib/venues";
import type { VenueFeatureObservation, VenueFeatureSource } from "@/lib/venueFeatureEvidence";

const state = {
  venues: [] as ConciergeVenue[],
  pricedVenues: [] as Venue[],
  prices: { prices: [] as CommunityPrice[], degraded: false },
  whatsOn: { rows: [] as WhatsOnRow[], kindObservedAt: {} },
  whatsOnThrows: false,
  whatsOnReadStatus: "ready" as "ready" | "degraded",
  pricedVenuesThrows: false,
  amenityRows: [] as unknown[],
  amenityThrows: false,
  chainPages: { version: 1, pages: [], quotes: [], readers: {}, quoteReaders: [] } as unknown,
  desk: { venues: [], status: "ready" } as DeskVenueRead,
};

vi.mock("@/lib/concierge/venues.server", () => ({
  loadConciergeVenues: vi.fn(async () => state.venues),
}));

vi.mock("@/lib/venuePriceIndex", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/venuePriceIndex")>(),
  getPricedVenues: vi.fn(async () => {
    if (state.pricedVenuesThrows) throw new Error("down");
    return state.pricedVenues;
  }),
}));

vi.mock("@/data/amenities/london_pub_website_evidence.json", () => ({
  default: {
    version: 1,
    get rows() {
      if (state.amenityThrows) throw new Error("unreadable");
      return state.amenityRows;
    },
  },
}));

vi.mock("@/data/amenities/london_pub_website_chain_pages.json", () => ({
  get default() {
    return state.chainPages;
  },
}));

vi.mock("@/lib/communityPriceStore", () => ({
  readCommunityPricesWithStatus: vi.fn(async () => state.prices),
}));

// A tiny stand-in for the tonight window: rows are kept only when their own
// start sits inside the twelve hours around the clock the CALLER handed in, so
// a handler that leaves `now` out of the read answers about another day. A
// DATE-ONLY row states a day and no clock time, and the real store windows it
// by that day, so it is kept when its stated date is the caller's own.
vi.mock("@/lib/whatsOnStore", () => ({
  loadWhatsOn: vi.fn(async (_params: unknown, deps: { now?: number } = {}) => {
    if (state.whatsOnThrows) throw new Error("down");
    const now = deps.now ?? Date.now();
    return {
      ...state.whatsOn,
      readStatus: state.whatsOnReadStatus,
      rows: state.whatsOn.rows.filter((row) => {
        if (!row.startsAt && row.startsDate) {
          return row.startsDate === new Date(now).toISOString().slice(0, 10);
        }
        const startsAt = row.startsAt ? Date.parse(row.startsAt) : Number.NaN;
        return (
          Number.isFinite(startsAt) && Math.abs(startsAt - now) <= 12 * 3_600_000
        );
      }),
    };
  }),
}));

vi.mock("@/lib/ask/deskVenues.server", () => ({
  loadDeskVenues: vi.fn(async () => state.desk),
}));

import { CHEAPEST_NEAR_NO_ANCHOR, VENUE_DRINKS_NO_VENUE } from "@/lib/ask/conciergeTools";
import { routeAskDeterministically } from "@/lib/ask/router";
import { runAskTool } from "@/lib/ask/tools";
import { QUIET_NOT_CHECKED } from "@/lib/concierge/rank";
import { requirementKey, venueRequirementsInText } from "@/lib/concierge/requirements";
import type { AskToolContext } from "@/lib/ask/toolContract";
import { defined } from "@/__tests__/helpers/defined";

const NOW = Date.parse("2026-08-15T20:30:00.000Z");

function ctx(overrides: Partial<AskToolContext> = {}): AskToolContext {
  return { cityId: "london", query: "", now: NOW, skipModel: true, ...overrides };
}

function venue(overrides: Partial<ConciergeVenue> & { id: string; name: string }): ConciergeVenue {
  return {
    area: "Camden",
    lat: 51.5,
    lng: -0.13,
    cheapestPrice: 5,
    priceSource: "Pub menu",
    priceObservedAt: "2026-01-01",
    amenities: {
      beerGarden: false,
      cocktails: false,
      food: false,
      liveSports: false,
      liveMusic: false,
    },
    nearWater: false,
    hasStory: false,
    canonical: true,
    ...overrides,
  };
}

function price(overrides: Partial<CommunityPrice> = {}): CommunityPrice {
  return {
    venueId: "v1",
    drinkCategory: "beer",
    priceGbp: 5.4,
    submittedAt: NOW - 86_400_000,
    source: "community",
    corroborations: 2,
    ...overrides,
  } as CommunityPrice;
}

beforeEach(() => {
  state.venues = [];
  state.pricedVenues = [];
  state.pricedVenuesThrows = false;
  state.amenityRows = [];
  state.amenityThrows = false;
  state.chainPages = { version: 1, pages: [], quotes: [], readers: {}, quoteReaders: [] };
  state.prices = { prices: [], degraded: false };
  state.whatsOn = { rows: [], kindObservedAt: {} };
  state.whatsOnThrows = false;
  state.whatsOnReadStatus = "ready";
  state.desk = { venues: [], status: "ready" };
});

describe("search price clock", () => {
  it("applies the supplied instant to budget filtering and price preference", async () => {
    state.venues = [
      venue({ id: "valid", name: "Pub Valid", cheapestPrice: 5, priceObservedAt: "2026-08-15T19:00:00Z" }),
      venue({ id: "future", name: "Pub Future", cheapestPrice: 3, priceObservedAt: "2026-08-15T21:00:00Z" }),
    ];
    const result = await runAskTool("search_venues", { query: "Pints under £6 in Camden" }, ctx({ query: "Pints under £6 in Camden" }));
    expect(result.cards.map((card) => card.venueId)).toEqual(["valid"]);
  });
});

describe("original-question tool authority", () => {
  it("keeps the original listing kind and area despite a provider rewrite", async () => {
    const result = await runAskTool("whats_on", { query: "Quiz tonight in Soho" },
      ctx({ query: "Live music tonight in Camden" }));
    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({ kind: "music", area: "Camden" });
    expect(result.answerHint).toMatch(/live[- ]music.*Camden/i);
    expect(result.answerHint).not.toMatch(/Soho|quiz/i);
  });

  it("returns a dated quiz listing in the asked area and leaves other areas out", async () => {
    const quiz = (id: string, placeName: string): WhatsOnRow => ({
      id,
      placeName,
      kind: "quiz",
      title: "Quiz night",
      startsAt: "2026-08-15T19:30:00.000Z",
      endsAt: "2026-08-15T21:30:00.000Z",
      source: { label: "Venue site", url: `https://example.com/${id}` },
      observedAt: "2026-08-14T09:00:00.000Z",
      confidence: "listed",
    });
    state.whatsOn = { rows: [quiz("soho", "The Toucan, Soho"), quiz("camden", "The Lock, Camden")], kindObservedAt: {} };
    const query = "Pub quiz tonight in Soho";
    const result = await runAskTool("whats_on", { query }, ctx({ query }));
    expect(result.ok).toBe(true);
    expect(result.cards.map((card) => [card.title, card.place, card.provenance?.url])).toEqual([
      ["Quiz night", "The Toucan, Soho", "https://example.com/soho"],
    ]);
    expect(result.data).toMatchObject({ kind: "quiz", area: "Soho", listings: [{ startsAt: "2026-08-15T19:30:00.000Z" }] });
  });
});

describe("search_venues hard requirements", () => {
  type Proof = { requirement: string; source: string | null; observedAt: string | null };
  type SearchData = {
    intent: { area?: string };
    requirements: string[];
    coverageGaps: string[];
    found: number;
    outdoorSeatingOnly: boolean;
    venues: { id: string; evidence?: Proof[] }[];
    unverified: { id: string; requirements: string[] }[];
  };
  const observed = (source: VenueFeatureSource, observedAt: string): VenueFeatureObservation => [true, source, observedAt];
  const search = (query: string, limit = 4) => runAskTool("search_venues", { query, limit }, ctx({ query }));
  const searchData = (result: Awaited<ReturnType<typeof search>>) => result.data as SearchData;
  const noAmenities = { beerGarden: false, cocktails: false, food: false, liveSports: false, liveMusic: false };
  const pricedDrinks = (id: string, ...rows: Partial<VenuePrice>[]) => ({
    id,
    prices: rows.map((row) => ({
      price_gbp: 5,
      pub_url: `https://www.pint-prices.com/pub/${id}`,
      scraped_at_values: "2026-08-01T12:00:00+00:00",
      ...row,
    })),
  }) as Venue;
  const garden = venue({ id: "garden", name: "The Garden Pub", area: "Soho", amenities: { ...noAmenities, beerGarden: true }, features: { garden: observed("OpenStreetMap", "2026-07-05") } });
  const pavement = venue({ id: "pavement", name: "The Pavement", area: "Soho", cheapestPrice: 4, amenities: { ...noAmenities, beerGarden: true }, features: { outdoorSeating: observed("Google Places", "2026-07-01") } });
  const flagOnly = venue({ id: "flag", name: "The Flag", area: "Soho", cheapestPrice: 3, amenities: { ...noAmenities, beerGarden: true } });
  const quizRow = (venueId: string, overrides: Partial<WhatsOnRow> = {}): WhatsOnRow => ({
    id: `quiz-${venueId}`,
    venueId,
    placeName: venueId,
    kind: "quiz",
    title: "Quiz night",
    startsAt: "2026-08-15T19:30:00.000Z",
    source: { label: "Venue site", url: `https://example.com/${venueId}` },
    observedAt: "2026-08-14T09:00:00.000Z",
    confidence: "listed",
    ...overrides,
  });

  const withoutWetherspoons = [
    "a beer garden in Hackney. No Wetherspoons",
    "a beer garden in Hackney, not a Wetherspoon",
  ];

  it.each(withoutWetherspoons)("retains the garden and Wetherspoon exclusion: %s", (query) => {
    expect(venueRequirementsInText(query).map(requirementKey)).toEqual(["garden", "not:wetherspoon"]);
  });

  it.each(withoutWetherspoons)("never offers a Wetherspoon for an excluded-chain garden ask: %s", async (query) => {
    state.venues = [
      { ...garden, id: "independent", name: "The Independent", area: "Hackney" },
      {
        ...garden,
        id: "spoons",
        name: "The Rochester Castle",
        sourceName: "The Rochester Castle - JD Wetherspoon",
        area: "Hackney",
      },
    ];

    const result = await search(query);

    expect(result.cards.map((card) => card.venueId)).not.toContain("spoons");
    expect(result.proposals.flatMap((proposal) => proposal.kind === "open_venue" ? [proposal.venueId] : [])).not.toContain("spoons");
    expect(searchData(result).venues.map((row) => row.id)).not.toContain("spoons");
    expect(searchData(result).requirements).toEqual(["garden", "not:wetherspoon"]);
  });

  it("keeps pavement seating and undated flags out of a beer garden ask, and counts how many qualify", async () => {
    state.venues = [garden, pavement, flagOnly];
    const result = await search("Three pubs in Soho with a beer garden", 3);
    expect(result.cards.map((card) => card.venueId)).toEqual(["garden"]);
    expect(searchData(result)).toMatchObject({
      requirements: ["garden"],
      found: 1,
      outdoorSeatingOnly: true,
      venues: [{ id: "garden", evidence: [{ requirement: "garden", source: "OpenStreetMap", observedAt: "2026-07-05" }] }],
    });
    state.venues = [garden, flagOnly];
    expect(searchData(await search("Three pubs in Soho with a beer garden", 3))).toMatchObject({ found: 1, outdoorSeatingOnly: false });
  });

  it("refuses feature evidence that is dated after now or comes from a source the map does not accept", async () => {
    state.venues = [
      garden,
      venue({ id: "future", name: "The Future", area: "Soho", cheapestPrice: 3, features: { garden: observed("OpenStreetMap", "2026-09-01") } }),
      venue({ id: "places-garden", name: "The Places Garden", area: "Soho", cheapestPrice: 3, features: { garden: observed("Google Places", "2026-07-01") } }),
      venue({ id: "places-dogs", name: "The Places Dogs", area: "Soho", cheapestPrice: 3, features: { dogsWelcome: observed("Google Places", "2026-07-01") } }),
      venue({ id: "site-dogs", name: "The Site Dogs", area: "Soho", cheapestPrice: 4, features: { dogsWelcome: observed("Pub website", "2026-07-01") } }),
    ];
    expect((await search("Pubs in Soho with a beer garden")).cards.map((card) => card.venueId)).toEqual(["garden"]);
    expect((await search("Dog friendly pubs in Soho")).cards.map((card) => card.venueId)).toEqual(["site-dogs"]);
  });

  it("lets dated outdoor seating answer a sit-outside ask and proves it as seating, not a garden", async () => {
    state.venues = [garden, pavement, flagOnly];
    const result = await search("Pubs in Soho where we can sit outside");
    expect(result.cards.map((card) => card.venueId).sort()).toEqual(["garden", "pavement"]);
    const pavementProof = searchData(result).venues.find((row) => row.id === "pavement")?.evidence;
    expect(pavementProof).toEqual([{ requirement: "outdoor-seating", source: "Google Places", observedAt: "2026-07-01" }]);
  });

  it("matches a named drink only on a sourced, dated price row for that pub", async () => {
    state.venues = [
      venue({ id: "guinness", name: "The Harp", area: "Soho", drinkText: "guinness ; peroni" }),
      venue({ id: "tagged", name: "The Tagged Harp", area: "Soho", cheapestPrice: 2, drinkText: "guinness" }),
      venue({ id: "future", name: "The Future Harp", area: "Soho", cheapestPrice: 2.2, drinkText: "guinness" }),
      venue({ id: "lager", name: "The Lager House", area: "Soho", cheapestPrice: 3, drinkText: "peroni ; madri" }),
      venue({ id: "unknown", name: "The Unknown", area: "Soho", cheapestPrice: 2.5 }),
    ];
    state.pricedVenues = [
      pricedDrinks("guinness", { pint_name: "Guinness" }, { pint_name: "Peroni" }),
      pricedDrinks("tagged", { pint_name: "Guinness", pub_url: "", scraped_at_values: "" }),
      pricedDrinks("future", { pint_name: "Guinness", scraped_at_values: "2026-09-01T12:00:00+00:00" }),
      pricedDrinks("lager", { pint_name: "Peroni" }),
    ];
    const guinness = await search("Show me 2 pubs in Soho that serve Guinness", 2);
    expect(guinness.cards.map((card) => card.venueId)).toEqual(["guinness"]);
    expect(searchData(guinness)).toMatchObject({
      requirements: ["drink:Guinness"],
      coverageGaps: [],
      found: 1,
      venues: [{ id: "guinness", evidence: [{ requirement: "drink:Guinness", source: "Pint Prices", observedAt: "2026-08-01T12:00:00.000Z" }] }],
    });
    expect(searchData(guinness).unverified.map((row) => row.id).sort()).toEqual(["future", "tagged"]);
    const stout = await search("Pubs in Soho with a stout");
    expect(stout.cards.map((card) => card.venueId)).toEqual(["guinness"]);
  });

  it("names the gap instead of matching drinks when the price rows cannot be read", async () => {
    state.venues = [venue({ id: "guinness", name: "The Harp", area: "Soho", drinkText: "guinness" })];
    state.pricedVenuesThrows = true;
    const result = await search("Pubs in Soho that serve Guinness");
    expect(result.cards).toEqual([]);
    expect(searchData(result)).toMatchObject({ coverageGaps: ["drink:Guinness"], found: 0, unverified: [{ id: "guinness", requirements: ["drink:Guinness"] }] });
  });

  it("returns nothing rather than a guess when no pub has the asked drink on record", async () => {
    state.venues = [venue({ id: "guinness", name: "The Harp", area: "Soho", drinkText: "guinness ; peroni" })];
    state.pricedVenues = [pricedDrinks("guinness", { pint_name: "Guinness" }, { pint_name: "Peroni" })];
    const result = await search("Show me 5 pubs in Soho that match my interest in gin and beer", 5);
    expect(result.cards).toEqual([]);
    expect(searchData(result)).toMatchObject({ found: 0, coverageGaps: [], unverified: [] });
  });

  const siteRow = (venueId: string | null, amenities: Record<string, string>, overrides: Record<string, unknown> = {}) => ({
    osmId: `node/${venueId ?? "unlinked"}`,
    name: "The Oche",
    venueId,
    sourceUrl: `https://${venueId ?? "unlinked"}.example/`,
    verifiedAt: "2026-08-01",
    amenities,
    ...overrides,
  });
  const dartsTagged = (id: string) =>
    venue({ id, name: `The Oche ${id}`, area: "Soho", cheapestPrice: 4, amenities: { ...noAmenities, darts: true } });

  it.each([
    ["a pub with darts and pool", ["darts", "pool"]],
    ["pubs with a dart board and pool", ["darts", "pool"]],
    ["a pub where I can play pool and darts", ["darts", "pool"]],
    ["no pool but darts please", ["darts", "not:pool"]],
    ["darts, not pool", ["darts", "not:pool"]],
  ])("keeps both joined game requirements: %s", (query, required) => {
    expect(venueRequirementsInText(query).map(requirementKey)).toEqual(required);
  });

  it("confirms joined games only when both have dated website evidence", async () => {
    state.venues = ["both", "darts-only"].map((id) => dartsTagged(id));
    state.amenityRows = [
      siteRow("both", { darts: "dart board", pool: "two pool tables" }),
      siteRow("darts-only", { darts: "dart board" }),
    ];
    const result = await search("a pub with darts and pool in Soho");
    expect(searchData(result).requirements).toEqual(["darts", "pool"]);
    expect(result.cards.map((card) => card.venueId)).toEqual(["both"]);
    expect(searchData(result).venues).toMatchObject([{
      id: "both",
      evidence: [
        { requirement: "darts", source: "Pub website", observedAt: "2026-08-01" },
        { requirement: "pool", source: "Pub website", observedAt: "2026-08-01" },
      ],
    }]);
  });

  it("discloses the unchecked joined game instead of confirming a partial match", async () => {
    state.venues = [venue({
      id: "both", name: "The Games Room", area: "Soho",
      amenities: { ...noAmenities, darts: true, pool: true },
    })];
    state.amenityRows = [siteRow("both", { darts: "dart board" })];
    const result = await search("a pub with darts and pool in Soho");
    expect(result.cards).toEqual([]);
    expect(searchData(result)).toMatchObject({
      requirements: ["darts", "pool"],
      found: 0,
      unverified: [{ id: "both", requirements: ["pool"] }],
    });
    expect(result.answerHint).toContain("pool table");
    expect(result.answerHint).toContain("unchecked tag");
  });

  it("confirms darts and pool only from a dated pub website quote linked to that exact venue", async () => {
    state.venues = ["site", "future", "televised", "unlinked", "elsewhere", "bad-url", "bad-day"].map((id) => dartsTagged(id));
    state.amenityRows = [
      siteRow("site", { darts: "dart board", pool: "two pool tables" }),
      siteRow("future", { darts: "dart board" }, { verifiedAt: "2026-09-01" }),
      siteRow("televised", { darts: "watch the darts on our big screens" }),
      siteRow(null, { darts: "dart board" }),
      siteRow("another-venue", { darts: "dart board" }, { name: "The Oche elsewhere" }),
      siteRow("bad-url", { darts: "dart board" }, { sourceUrl: "not a url" }),
      siteRow("bad-day", { darts: "dart board" }, { verifiedAt: "2026-02-30" }),
    ];
    const darts = await search("Six pubs with a darts board in Soho", 6);
    expect(darts.cards.map((card) => card.venueId)).toEqual(["site"]);
    expect(searchData(darts)).toMatchObject({
      requirements: ["darts"],
      coverageGaps: [],
      found: 1,
      venues: [{ id: "site", evidence: [{ requirement: "darts", source: "Pub website", observedAt: "2026-08-01" }] }],
    });
    expect(searchData(darts).unverified.map((row) => row.id).sort()).toEqual(["bad-day", "bad-url", "elsewhere", "future", "televised", "unlinked"]);
    const pool = await search("Pubs in Soho with a pool table");
    expect(pool.cards.map((card) => card.venueId)).toEqual(["site"]);
  });

  it("drops a quote one host states for several venues", async () => {
    state.venues = ["chain-a", "chain-b"].map((id) => dartsTagged(id));
    state.amenityRows = ["chain-a", "chain-b"].map((id) => siteRow(id, { darts: "dart board" }, { sourceUrl: `https://chain.example/${id}` }));
    const result = await search("Pubs with a darts board in Soho");
    expect(result.cards).toEqual([]);
    expect(searchData(result)).toMatchObject({ coverageGaps: [], found: 0 });
  });

  it("keeps a bare darts tag unverified when no website evidence names the venue", async () => {
    state.venues = [
      venue({ id: "darts", name: "The Oche", area: "Soho", amenities: { ...noAmenities, darts: true } }),
      venue({ id: "plain", name: "The Plain", area: "Soho", cheapestPrice: 3 }),
    ];
    const result = await search("Pubs with a darts board in Soho");
    expect(result.cards).toEqual([]);
    expect(searchData(result)).toMatchObject({
      requirements: ["darts"],
      coverageGaps: [],
      found: 0,
      unverified: [{ id: "darts", requirements: ["darts"] }],
    });
  });

  it("names the darts gap when the website evidence cannot be read", async () => {
    state.venues = [dartsTagged("site")];
    state.amenityRows = [siteRow("site", { darts: "dart board" })];
    state.amenityThrows = true;
    const result = await search("Pubs with a darts board in Soho");
    expect(result.cards).toEqual([]);
    expect(searchData(result)).toMatchObject({ coverageGaps: ["darts"], found: 0, unverified: [{ id: "site" }] });
  });

  it.each([
    ["Pubs without a pool table in Hackney", ["not:pool"]],
    ["Pubs that are not dog friendly in Soho", ["not:dogs"]],
    ["Pubs in Soho without Guinness", ["not:drink:Guinness"]],
  ])("names an exclusion it cannot check instead of matching the opposite: %s", async (query, excluded) => {
    const area = query.includes("Hackney") ? "Hackney" : "Soho";
    state.venues = [
      venue({ id: "has-it", name: "The Has It", area, amenities: { ...noAmenities, pool: true }, drinkText: "guinness", features: { dogsWelcome: observed("OpenStreetMap", "2026-07-01") } }),
      venue({ id: "plain", name: "The Plain", area, cheapestPrice: 3 }),
    ];
    state.amenityRows = [siteRow("has-it", { pool: "two pool tables" })];
    state.pricedVenues = [pricedDrinks("has-it", { pint_name: "Guinness" })];
    const result = await search(query);
    expect(result.cards).toEqual([]);
    expect(searchData(result)).toMatchObject({ requirements: excluded, coverageGaps: excluded, found: 0, unverified: [] });
    const positive = await search(query.replace(/without a|not|without/, "with").replace("with dog", "dog"));
    expect(positive.cards.map((card) => card.venueId)).toEqual(["has-it"]);
  });

  const hasEverything = (area: string) => {
    state.venues = [
      venue({ id: "has-it", name: "The Has It", area, amenities: { ...noAmenities, pool: true, darts: true }, drinkText: "guinness ; jameson irish whiskey", features: { dogsWelcome: observed("OpenStreetMap", "2026-07-01") } }),
      venue({ id: "plain", name: "The Plain", area, cheapestPrice: 3 }),
    ];
    state.amenityRows = [siteRow("has-it", { pool: "two pool tables", darts: "dart board" })];
    state.pricedVenues = [pricedDrinks("has-it", { pint_name: "Guinness" }, { pint_name: "Jameson Irish Whiskey" })];
  };

  it.each([
    ["Pubs without any sort of a pool table in Hackney", "not:pool"],
    ["Avoid pubs with a pool table in Hackney", "not:pool"],
    ["I don't want a pub with a pool table in Hackney", "not:pool"],
    ["Skip anywhere with a darts board in Hackney", "not:darts"],
    ["Pubs that are not in the slightest bit dog friendly in Hackney", "not:dogs"],
    ["Pubs with no dogs in Hackney", "not:dogs"],
    ["Pubs where dogs are not allowed in Hackney", "not:dogs"],
    ["Pubs with no whiskey in Hackney", "not:drink:whisky"],
  ])("confirms no pub for an exclusion it cannot check: %s", async (query, excluded) => {
    hasEverything("Hackney");
    const result = await search(query);
    expect(result.cards).toEqual([]);
    expect(searchData(result).requirements).toContain(excluded);
    expect(searchData(result).coverageGaps).toContain(excluded);
  });

  it.each([
    ["Pubs without anything resembling a pool table in Hackney", "Hackney", "pool"],
    ["Pubs without anything that anybody at all could ever honestly describe as a real pool table in Hackney", "Hackney", "pool"],
    ["Pubs that are not in any conceivable way dog friendly in Soho", "Soho", "dogs"],
    ["Pubs that never under any circumstances serve Guinness in Hackney", "Hackney", "drink:Guinness"],
    ["Pubs that do not ever seem to have anything resembling a decent pint of Guinness on tap in Hackney", "Hackney", "drink:Guinness"],
  ])("confirms no pub when a negative's scope is not understood: %s", async (query, area, key) => {
    hasEverything(area);
    const result = await search(query);
    expect(searchData(result).intent).toMatchObject({ area });
    expect(result.cards).toEqual([]);
    expect(searchData(result).requirements.some((requirement) => requirement.endsWith(`:${key}`))).toBe(true);
    expect(searchData(result).coverageGaps.some((gap) => gap.endsWith(`:${key}`))).toBe(true);
  });

  it.each([
    ["Pubs without (to be clear) a pool table in Hackney", "Hackney", "pool"],
    ["A pool-table-free pub in Hackney", "Hackney", "pool"],
    ["A Guinness-free pub in Hackney", "Hackney", "drink:Guinness"],
    ["Pubs where pool tables are not allowed in Hackney", "Hackney", "pool"],
    ["Pubs where Guinness is not served in Hackney", "Hackney", "drink:Guinness"],
    ["Pubs with free pool tables in Hackney", "Hackney", "pool"],
  ])("confirms no pub when an aside or a trailing negative leaves scope open: %s", async (query, area, key) => {
    hasEverything(area);
    const result = await search(query);
    expect(searchData(result).intent).toMatchObject({ area });
    expect(result.cards).toEqual([]);
    expect(searchData(result).coverageGaps.some((gap) => gap.endsWith(`:${key}`))).toBe(true);
  });

  it.each([
    ["a beer garden in Hackney, no music", ["garden"]],
    ["pubs with a pool table, no TVs, in Hackney", ["pool"]],
    ["dog friendly pubs, nothing fancy", ["dogs"]],
    ["pub quiz in hackney, no football", ["quiz"]],
    ["pubs with a garden that don't play music", ["garden"]],
    ["pubs with a garden that do not play music", ["garden"]],
    ["pubs with a garden, don't play music", ["garden"]],
    ["pubs with a garden, not a music venue", ["garden"]],
    ["pubs with a garden; no music", ["garden"]],
    ["pubs with a garden. No music", ["garden"]],
    ["no music, pubs with a garden", ["garden"]],
    ["no music; pubs with a garden", ["garden"]],
    ["no music. Pubs with a garden", ["garden"]],
    ["Pubs without, frankly, a pool table in Hackney", ["pool"]],
    ["pubs with Guinness, no music", ["drink:Guinness"]],
    ["no music, pubs with Guinness", ["drink:Guinness"]],
    ["pubs with a garden, no pool table", ["garden", "not:pool"]],
    ["pubs with a pool table not allowed", ["unclear:pool"]],
  ])("scopes a negator to its own feature and clause: %s", (query, required) => {
    expect(venueRequirementsInText(query).map(requirementKey)).toEqual(required);
  });

  it.each([
    ["Pubs not too pricey with a pool table in Hackney", ["pool"]],
    ["Pubs that have not only a pool table but also a darts board in Hackney", ["darts", "pool"]],
    ["Pubs that serve whiskey in Hackney", ["drink:whisky"]],
    ["Pubs with no TV but a pool table in Hackney", ["pool"]],
    ["Pubs with a pool table that are not too loud in Hackney", ["pool"]],
    ["Pubs with Guinness and a pool table in Hackney", ["pool", "drink:Guinness"]],
    ["Pubs with a pool table, not too pricey, in Hackney", ["pool"]],
    ["Not sure yet, but pubs with a pool table in Hackney", ["pool"]],
    ["Pubs with Guinness and no music in Hackney", ["drink:Guinness"]],
  ])("keeps a positive requirement positive: %s", async (query, required) => {
    hasEverything("Hackney");
    const result = await search(query);
    expect(searchData(result)).toMatchObject({ requirements: required, coverageGaps: [] });
    expect(result.cards.map((card) => card.venueId)).toEqual(["has-it"]);
  });

  it("keeps the unchecked quiet mood on a card matched by a garden", async () => {
    state.venues = [
      venue({ id: "garden", name: "The Garden Pub", area: "Camden", amenities: { ...noAmenities, beerGarden: true, food: true }, features: { garden: observed("OpenStreetMap", "2026-07-05") } }),
      venue({ id: "music", name: "The Music Garden", area: "Camden", cheapestPrice: 3, amenities: { ...noAmenities, beerGarden: true, liveMusic: true }, features: { garden: observed("OpenStreetMap", "2026-07-05") } }),
    ];
    const result = await search("Quiet pubs with a beer garden in Camden");
    expect(result.cards.map((card) => card.venueId).sort()).toEqual(["garden", "music"]);
    for (const card of result.cards) expect(card.note).toContain(QUIET_NOT_CHECKED);
    const quietOnly = await search("Quiet pubs in Camden");
    for (const card of quietOnly.cards) expect(card.note).toContain(QUIET_NOT_CHECKED);
  });

  it("drops website evidence from a page the committed chain list names", async () => {
    state.venues = [dartsTagged("chain-page"), dartsTagged("own-page")];
    state.amenityRows = [
      siteRow("chain-page", { darts: "dart board" }, { sourceUrl: "https://brand.example/our-pubs" }),
      siteRow("own-page", { darts: "dart board" }),
    ];
    state.chainPages = { version: 1, pages: ["brand.example/our-pubs"], quotes: [], readers: {}, quoteReaders: [] };
    const result = await search("Pubs with a darts board in Soho");
    expect(result.cards.map((card) => card.venueId)).toEqual(["own-page"]);
    expect(searchData(result).unverified.map((row) => row.id)).toEqual(["chain-page"]);
    state.chainPages = { version: 1, pages: "not a list" };
    const unreadable = await search("Pubs with a darts board in Soho");
    expect(unreadable.cards).toEqual([]);
    expect(searchData(unreadable).coverageGaps).toEqual(["darts"]);
  });

  it("keeps a positive requirement and an exclusion apart in one ask", async () => {
    state.venues = [
      venue({ id: "garden-pool", name: "The Garden Pool", area: "Soho", amenities: { ...noAmenities, pool: true }, features: { garden: observed("OpenStreetMap", "2026-07-05") } }),
      venue({ id: "garden-only", name: "The Garden Only", area: "Soho", cheapestPrice: 3, features: { garden: observed("OpenStreetMap", "2026-07-05") } }),
    ];
    state.amenityRows = [siteRow("garden-pool", { pool: "two pool tables" })];
    const result = await search("Pubs in Soho with a beer garden but no pool table");
    expect(result.cards).toEqual([]);
    expect(searchData(result)).toMatchObject({ requirements: ["garden", "not:pool"], coverageGaps: ["not:pool"], found: 0, unverified: [] });
  });

  it("keeps a verified requirement apart from an unproven tag in the same ask", async () => {
    state.venues = [
      venue({ id: "garden-pool", name: "The Garden Pool", area: "Soho", amenities: { ...noAmenities, pool: true }, features: { garden: observed("OpenStreetMap", "2026-07-05") } }),
      venue({ id: "pool-only", name: "The Pool Room", area: "Soho", cheapestPrice: 3, amenities: { ...noAmenities, pool: true } }),
    ];
    const result = await search("Pubs in Soho with a beer garden and a pool table");
    expect(result.cards).toEqual([]);
    expect(searchData(result)).toMatchObject({
      coverageGaps: [],
      found: 0,
      unverified: [{ id: "garden-pool", requirements: ["pool"] }],
    });
  });

  it("answers a quiz requirement only from a sourced quiz listing for that pub", async () => {
    state.venues = [
      garden,
      venue({ id: "quiz-only", name: "The Quizzer", area: "Soho", cheapestPrice: 3 }),
      venue({ id: "named-quiz", name: "The Quiz Tavern", area: "Soho", cheapestPrice: 2 }),
    ];
    state.whatsOn = {
      rows: [
        quizRow("garden"),
        quizRow("quiz-only"),
        quizRow("future-observed", { observedAt: "2026-08-16T09:00:00.000Z" }),
        quizRow("music", { kind: "music" }),
      ],
      kindObservedAt: {},
    };
    const both = await search("Five pubs with a garden and a quiz in Soho", 5);
    expect(both.cards.map((card) => card.venueId)).toEqual(["garden"]);
    expect(searchData(both)).toMatchObject({
      requirements: ["garden", "quiz"],
      coverageGaps: [],
      found: 1,
      venues: [{ id: "garden", evidence: [
        { requirement: "garden", source: "OpenStreetMap", observedAt: "2026-07-05" },
        { requirement: "quiz", source: "Venue site", observedAt: "2026-08-14T09:00:00.000Z" },
      ] }],
    });
    const quiz = await search("Two pubs with a quiz in Soho", 2);
    expect(quiz.cards.map((card) => card.venueId).sort()).toEqual(["garden", "quiz-only"]);
  });

  it.each([
    ["degraded", () => { state.whatsOnReadStatus = "degraded"; }],
    ["throwing", () => { state.whatsOnThrows = true; }],
  ])("fails a quiz requirement closed and names the gap when the listings read is %s", async (_label, breakRead) => {
    state.venues = [garden];
    state.whatsOn = { rows: [quizRow("garden")], kindObservedAt: {} };
    breakRead();
    const result = await search("Pubs with a garden and a quiz in Soho");
    expect(result.cards).toEqual([]);
    expect(searchData(result)).toMatchObject({ requirements: ["garden", "quiz"], coverageGaps: ["quiz"], found: 0 });
  });

  it("returns as many pubs as the ask counts, even when the caller asked for another number", async () => {
    state.venues = ["a", "b", "c", "d"].map((id, index) => venue({ id, name: `The ${id}`, area: "Soho", cheapestPrice: 3 + index, features: { dogsWelcome: observed("OpenStreetMap", "2026-07-01") } }));
    const query = "A couple of dog friendly pubs in Soho";
    const result = await runAskTool("search_venues", { query, limit: 4 }, ctx({ query }));
    expect(result.cards).toHaveLength(2);
  });

  it.each([
    "Pubs in Camden",
    "Quiet pubs in Covent Garden",
    "Pubs near Hatton Garden",
  ])("does not read a place name as a drink or a garden: %s", async (query) => {
    const area = /Camden/.test(query) ? "Camden" : query.includes("Covent") ? "Covent Garden" : "Hatton Garden";
    state.venues = [
      venue({ id: "a", name: "The First", area }),
      venue({ id: "b", name: "The Second", area, cheapestPrice: 4 }),
    ];
    const result = await search(query);
    expect(result.cards.map((card) => card.venueId).sort()).toEqual(["a", "b"]);
    expect(searchData(result).requirements).toEqual([]);
  });

  it("keeps a brand that starts with a place name, and drops an adjective that only looks like a style", async () => {
    state.venues = [
      venue({ id: "hells", name: "The Hells", area: "Soho", drinkText: "camden hells" }),
      venue({ id: "peroni", name: "The Peroni", area: "Soho", cheapestPrice: 3, drinkText: "peroni" }),
    ];
    state.pricedVenues = [pricedDrinks("hells", { pint_name: "Camden Hells" }), pricedDrinks("peroni", { pint_name: "Peroni" })];
    const brand = await search("Camden Hells in Soho");
    expect(brand.cards.map((card) => card.venueId)).toEqual(["hells"]);
    expect(searchData(brand).requirements).toEqual(["drink:Camden Hells"]);
    const adjective = await search("Pubs in Soho for a hazy evening");
    expect(adjective.cards.map((card) => card.venueId).sort()).toEqual(["hells", "peroni"]);
  });
});

describe("propose_plan hard requirements", () => {
  type PlanData = { stops?: { id: string }[]; requirements?: string[]; coverageGaps?: string[] };
  const observed = (source: VenueFeatureSource, observedAt: string): VenueFeatureObservation => [true, source, observedAt];
  const soho = (id: string, index: number, gardened: boolean) => venue({
    id,
    name: `The ${id}`,
    area: "Soho",
    lat: 51.513 + index * 0.0007,
    lng: -0.133,
    cheapestPrice: 3 + index * 0.1,
    ...(gardened ? { features: { garden: observed("OpenStreetMap", "2026-07-01") } } : {}),
  });
  const plan = (query: string) => runAskTool("propose_plan", { query }, ctx({ query }));
  const draftIds = (result: Awaited<ReturnType<typeof plan>>) =>
    result.proposals.flatMap((proposal) => proposal.kind === "draft_plan" ? [proposal.stopIds] : []);

  it("drafts only pubs that meet the asked requirement, in the counted number of stops", async () => {
    state.venues = [
      ...["g1", "g2", "g3", "g4", "g5"].map((id, index) => soho(id, index, true)),
      ...["n1", "n2", "n3"].map((id, index) => soho(id, index + 5, false)),
    ];
    const result = await plan("Plan a crawl of five pubs with beer gardens in Soho");
    const stops = (result.data as PlanData).stops?.map((stop) => stop.id) ?? [];
    expect(result.ok).toBe(true);
    expect(stops).toHaveLength(5);
    expect(stops.every((id) => id.startsWith("g"))).toBe(true);
    expect(draftIds(result)).toEqual([stops]);
  });

  it("drafts nothing and offers no unqualified pub when too few meet the requirement", async () => {
    state.venues = [soho("g1", 0, true), ...["n1", "n2", "n3"].map((id, index) => soho(id, index + 1, false))];
    const result = await plan("Plan a crawl of three pubs with beer gardens in Soho");
    expect(result.ok).toBe(false);
    expect(draftIds(result)).toEqual([]);
    expect(result.cards.map((card) => card.venueId)).toEqual(["g1"]);
    expect(result.data).toMatchObject({ requirements: ["garden"], coverageGaps: [] });
  });

  it("drafts no quiz crawl when the quiz listings cannot be read", async () => {
    state.venues = ["g1", "g2", "g3"].map((id, index) => soho(id, index, true));
    state.whatsOnReadStatus = "degraded";
    const result = await plan("Plan a pub crawl with a quiz in Soho");
    expect(result.ok).toBe(false);
    expect(draftIds(result)).toEqual([]);
    expect(result.cards).toEqual([]);
    expect(result.data).toMatchObject({ requirements: ["quiz"], coverageGaps: ["quiz"] });
  });

  it("drafts no darts crawl from bare darts tags with no website evidence", async () => {
    state.venues = ["d1", "d2", "d3"].map((id, index) => ({
      ...soho(id, index, false),
      amenities: { beerGarden: false, cocktails: false, food: false, liveSports: false, liveMusic: false, darts: true },
    }));
    const result = await plan("Plan a crawl of three pubs with darts boards in Soho");
    expect(result.ok).toBe(false);
    expect(draftIds(result)).toEqual([]);
    expect(result.cards).toEqual([]);
    expect(result.data).toMatchObject({ requirements: ["darts"], coverageGaps: [] });
  });
});

describe("cheapest_pint_near", () => {
  it("serialises grounded coordinates even when priced records use different coordinate names", async () => {
    state.venues = [
      venue({ id: "priced", name: "The Crown", lat: 51.54, lng: -0.14, cheapestPrice: 4 }),
      venue({ id: "listed", name: "The Ship", lat: 51.55, lng: -0.15, cheapestPrice: 5 }),
    ];
    state.pricedVenues = [{
      id: "priced", latitude: 51.54, longitude: -0.14, cheapestPrice: 4,
    } as Venue];
    const result = await runAskTool("cheapest_pint_near", { area: "Camden" }, ctx());
    expect(result.cards.map((card) => card.venueId)).toEqual(["priced", "listed"]);
    expect(JSON.parse(JSON.stringify(result.data)).venues).toEqual([
      { id: "priced", lat: 51.54, lng: -0.14 },
      { id: "listed", lat: 51.55, lng: -0.15 },
    ]);
  });

  it.each([{ area: "Camden" }, { area: "London" }, { venueName: "The Lamb" }])("uses the supplied price clock for %j", async (args) => {
    state.venues = [
      venue({ id: "anchor", name: "The Lamb", cheapestPrice: null }),
      venue({ id: "valid", name: "Pub Valid", cheapestPrice: 5, priceObservedAt: "2026-08-15T19:00:00Z" }),
      venue({ id: "future", name: "Pub Future", cheapestPrice: 3, priceObservedAt: "2026-08-15T21:00:00Z" }),
    ];
    const result = await runAskTool("cheapest_pint_near", args, ctx());
    expect(result.cards.map((card) => card.venueId)).toEqual(["valid"]);
  });

  it("ranks the listed pints round a named pub and leaves the anchor out", async () => {
    state.venues = [
      venue({ id: "anchor", name: "The Lamb", cheapestPrice: 4 }),
      venue({ id: "near-cheap", name: "The Crown", lat: 51.5005, cheapestPrice: 4.5 }),
      venue({ id: "near-dear", name: "The Ship", lat: 51.5008, cheapestPrice: 6.2 }),
    ];
    const result = await runAskTool("cheapest_pint_near", { venueName: "The Lamb" }, ctx());
    expect(result.ok).toBe(true);
    expect(result.cards.map((card) => card.venueId)).toEqual(["near-cheap", "near-dear"]);
    expect(result.answerHint).toContain("The Crown at £4.50");
    for (const card of result.cards) {
      expect(card.provenance?.label).toBe("Pub menu. Source read 1 January 2026. Link unavailable.");
      expect(card.note).toContain("Drink not recorded · Serving not recorded");
    }
  });

  it("keeps equal-price pubs with their own drink, stated serving, publisher and day", async () => {
    state.venues = [
      venue({ id: "first", name: "First Arms", cheapestPrice: 5, cheapestPint: "First lager", measure: "pint", priceSource: "First menu", priceObservedAt: "2026-01-12" }),
      venue({ id: "second", name: "Second Arms", cheapestPrice: 5, cheapestPint: "Second ale", priceSource: "Second menu", priceObservedAt: "2026-02-14" }),
    ];
    const result = await runAskTool("cheapest_pint_near", { area: "Camden" }, ctx());
    expect(result.cards.map((card) => [card.venueId, card.price])).toEqual([["first", 5], ["second", 5]]);
    expect(result.cards[0]).toMatchObject({ note: "First lager · Pint", provenance: { label: "First menu. Source read 12 January 2026. Link unavailable." } });
    expect(result.cards[1]).toMatchObject({ note: "Second ale · Serving not recorded", provenance: { label: "Second menu. Source read 14 February 2026. Link unavailable." } });
    expect(result.provenance.map((source) => source.label)).toEqual([
      "First menu. Source read 12 January 2026. Link unavailable.",
      "Second menu. Source read 14 February 2026. Link unavailable.",
    ]);
    expect(result.proposals.every((proposal) => proposal.kind === "open_venue")).toBe(true);
  });

  it("answers an area ask from the borough list", async () => {
    state.venues = [
      venue({ id: "a", name: "The Crown", area: "Camden", cheapestPrice: 6 }),
      venue({ id: "b", name: "The Ship", area: "Camden", cheapestPrice: 4.2 }),
      venue({ id: "c", name: "The Anchor", area: "Hackney", cheapestPrice: 3 }),
    ];
    const result = await runAskTool("cheapest_pint_near", { area: "Camden" }, ctx());
    expect(result.cards.map((card) => card.venueId)).toEqual(["b", "a"]);
    expect(result.answerHint).toContain("Cheapest listed pints in Camden");
  });

  it("answers bare London city-wide and refuses unknown districts", async () => {
    state.venues = [
      venue({ id: "camden", name: "The Crown", area: "Camden", cheapestPrice: 4.2 }),
      venue({ id: "hackney", name: "The Ship", area: "Hackney", cheapestPrice: 3.8 }),
      venue({ id: "city", name: "The Anchor", area: "City of London", cheapestPrice: 5.1 }),
    ];
    const london = await runAskTool("cheapest_pint_near", { area: "London" }, ctx());
    expect(london.ok).toBe(true);
    expect(london.cards.map((card) => card.venueId)).toEqual([
      "hackney",
      "camden",
      "city",
    ]);
    expect(london.answerHint).toContain("Cheapest listed pints in London");

    const soho = await runAskTool("cheapest_pint_near", { area: "Soho" }, ctx());
    expect(soho.ok).toBe(true);
    expect(soho.cards.length).toBeGreaterThan(0);
    expect(soho.answerHint).toContain("Soho");
  });

  it("asks for an anchor instead of guessing one", async () => {
    state.venues = [venue({ id: "a", name: "The Crown" })];
    const result = await runAskTool("cheapest_pint_near", {}, ctx());
    expect(result.ok).toBe(false);
    expect(result.answerHint).toContain("Name a listed pub");
    expect(result.cards).toHaveLength(0);
  });

  it("refuses a positional pronoun rather than landing on a pub that spells it", async () => {
    state.venues = [
      venue({ id: "bex", name: "Bexleyheath Working Mens Club", cheapestPrice: 3 }),
      venue({ id: "us", name: "The Custom House", cheapestPrice: 4 }),
    ];
    for (const query of ["cheapest pint near me", "cheapest pint near us"]) {
      const [call] = routeAskDeterministically(query);
      expect(call?.name).toBe("cheapest_pint_near");
      const result = await runAskTool("cheapest_pint_near", defined(call).args, ctx({ query }));
      expect(result.ok).toBe(false);
      expect(result.cards).toHaveLength(0);
      expect(result.answerHint).toBe(CHEAPEST_NEAR_NO_ANCHOR);
    }
  });

  it("still resolves a real area word arriving the same way", async () => {
    state.venues = [
      venue({ id: "a", name: "The Crown", area: "Camden", cheapestPrice: 6 }),
      venue({ id: "b", name: "The Ship", area: "Camden", cheapestPrice: 4.2 }),
    ];
    const [call] = routeAskDeterministically("cheapest pint near Camden");
    const result = await runAskTool("cheapest_pint_near", defined(call).args, ctx());
    expect(result.ok).toBe(true);
    expect(result.cards.map((card) => card.venueId)).toEqual(["b", "a"]);
  });

  it("never turns a place word it cannot place into a pub", async () => {
    // The pack files a pub under its BOROUGH, so a district word resolves to no
    // area. The Angel sits in Hillingdon, nowhere near Islington's Angel.
    state.venues = [
      venue({ id: "angel", name: "The Angel", area: "Hillingdon", cheapestPrice: 4 }),
      venue({ id: "crown", name: "The Crown", area: "Hillingdon", cheapestPrice: 4.5 }),
    ];
    const [call] = routeAskDeterministically("cheapest pint in Tyburnia");
    expect(call?.name).toBe("cheapest_pint_near");
    const result = await runAskTool("cheapest_pint_near", defined(call).args, ctx());
    expect(result.ok).toBe(false);
    expect(result.answerHint).toBe(CHEAPEST_NEAR_NO_ANCHOR);
    expect(result.cards).toHaveLength(0);
    expect(result.answerHint).not.toContain("Tyburnia");
  });

  it("still ranks round a pub the drinker named", async () => {
    state.venues = [
      venue({ id: "lamb", name: "The Lamb", area: "Camden", cheapestPrice: 4 }),
      venue({ id: "near", name: "The Crown", area: "Camden", lat: 51.5005, cheapestPrice: 4.5 }),
    ];
    const [call] = routeAskDeterministically("cheapest pint near The Lamb");
    const result = await runAskTool("cheapest_pint_near", defined(call).args, ctx());
    expect(result.ok).toBe(true);
    expect(result.answerHint).toContain("The Lamb");
    expect(result.cards.map((card) => card.venueId)).toContain("near");
    expect(result.cards.map((card) => card.venueId)).not.toContain("lamb");
  });

  it("reads a borough word in the centre slot as that borough", async () => {
    state.venues = [
      venue({ id: "a", name: "The Crown", area: "Westminster", cheapestPrice: 6 }),
      venue({ id: "b", name: "Golden Lion (Soho)", area: "Westminster", cheapestPrice: 4.2 }),
      venue({ id: "c", name: "The Anchor", area: "Hackney", cheapestPrice: 3 }),
    ];
    const result = await runAskTool(
      "cheapest_pint_near",
      { venueName: "Westminster" },
      ctx(),
    );
    expect(result.ok).toBe(true);
    expect(result.answerHint).toContain("Cheapest listed pints in Westminster");
    expect(result.cards.map((card) => card.venueId)).toEqual(["b", "a"]);
  });

  it("degrades honestly when the listed index could not be read", async () => {
    state.venues = [];
    const result = await runAskTool("cheapest_pint_near", { area: "Camden" }, ctx());
    expect(result.degraded).toBe(true);
    expect(result.answerHint).toContain("couldn't read");
  });
});

describe("tonight_now", () => {
  it("splits running from still-to-start and never claims a crowd reading", async () => {
    state.whatsOn = {
      rows: [
        {
          id: "running",
          placeName: "The Lamb",
          kind: "quiz",
          title: "Quiz night",
          startsAt: "2026-08-15T20:00:00.000Z",
          endsAt: "2026-08-15T22:00:00.000Z",
          source: { label: "Venue site", url: "https://example.com" },
          observedAt: "2026-08-15T09:00:00.000Z",
          confidence: "listed",
        },
        {
          id: "later",
          placeName: "The Crown",
          kind: "music",
          title: "Live set",
          startsAt: "2026-08-15T22:30:00.000Z",
          endsAt: "2026-08-16T00:00:00.000Z",
          source: { label: "Venue site", url: "https://example.com" },
          observedAt: "2026-08-15T09:00:00.000Z",
          confidence: "listed",
        },
      ],
      kindObservedAt: {},
    };
    const result = await runAskTool("tonight_now", {}, ctx());
    expect(result.ok).toBe(true);
    expect(result.answerHint).toContain("1 on right now");
    expect(result.answerHint).toContain("1 still to start tonight");
    expect(result.answerHint).toContain("No live crowd reading yet");
    expect(result.cards[0]?.note).toBe("On right now");
  });

  it("keeps listing counts when tonight listings exceed six cards", async () => {
    state.whatsOn = {
      rows: Array.from({ length: 7 }, (_, index) => ({
        id: `later-${index}`,
        placeName: `The Pub ${index}`,
        kind: "music" as const,
        title: `Live set ${index}`,
        startsAt: new Date(NOW + (30 + index * 15) * 60_000).toISOString(),
        endsAt: new Date(NOW + (90 + index * 15) * 60_000).toISOString(),
        source: { label: "Venue site", url: "https://example.com" },
        observedAt: "2026-08-15T09:00:00.000Z",
        confidence: "listed" as const,
      })),
      kindObservedAt: {},
    };
    const result = await runAskTool("tonight_now", {}, ctx());

    expect(result.cards).toHaveLength(6);
    expect(result.answerHint).toContain("7 still to start tonight");
    expect(result.answerHint).not.toContain("Here are the first 6.");
  });

  it("prints no bare figure for a listed night, and keeps the deal's own", async () => {
    // A kind=event priceGbp is a TICKET price. It belongs to the /out card,
    // worded "Tickets from £X" beside its source credit; a Pub Pal card prints
    // `price` as a bare figure, which in this product reads as a drink price.
    state.whatsOn = {
      rows: [
        {
          id: "ticketed",
          placeName: "Soho Theatre",
          kind: "event",
          title: "A Night at the Playhouse",
          startsAt: "2026-08-15T20:00:00.000Z",
          endsAt: "2026-08-15T22:00:00.000Z",
          priceGbp: 23.5,
          source: { label: "Ticketmaster", url: "https://www.ticketmaster.co.uk/event/1" },
          observedAt: "2026-08-15T09:00:00.000Z",
          confidence: "listed",
        },
        {
          id: "priced-deal",
          placeName: "The Lamb",
          kind: "deal",
          title: "Two for one",
          startsAt: "2026-08-15T20:00:00.000Z",
          endsAt: "2026-08-15T22:00:00.000Z",
          priceGbp: 4.5,
          source: { label: "Venue site", url: "https://example.com" },
          observedAt: "2026-08-15T09:00:00.000Z",
          confidence: "listed",
        },
      ],
      kindObservedAt: {},
    };
    const result = await runAskTool("tonight_now", {}, ctx());
    const byKey = new Map(result.cards.map((card) => [card.key, card]));
    expect(byKey.get("ticketed")?.price).toBeNull();
    expect(byKey.get("priced-deal")?.price).toBe(4.5);
    expect(JSON.stringify(result.cards)).not.toContain("23.5");
  });

  it("never says a date-only listing has or has not started", async () => {
    // Common (and a bare-date Skiddle listing) publishes a DAY and no clock
    // time. Calling it "still to start tonight" is a claim about a start the
    // source withheld, so the card carries the source's own line instead.
    state.whatsOn = {
      rows: [
        {
          id: "date-only",
          placeName: "Camberwell",
          kind: "event",
          title: "Sunday roast club",
          startsDate: "2026-08-15",
          timeEvidence: "Date listed, start time not published",
          source: { label: "common", url: "https://www.common-social.com/post/abc" },
          observedAt: "2026-08-15T09:00:00.000Z",
          confidence: "listed",
        },
      ],
      kindObservedAt: {},
    };
    const result = await runAskTool("tonight_now", {}, ctx());
    expect(result.cards).toHaveLength(1);
    expect(result.cards[0]?.note).toBe("Date listed, start time not published");
    expect(result.cards[0]?.note).not.toContain("start tonight");
    expect(result.cards[0]?.note).not.toContain("right now");
    // The summary counts it on its own, so it inflates neither running nor
    // still-to-start, and the answer is not "nothing sourced" either.
    expect(result.answerHint).toContain("1 listed tonight with no start time");
    expect(result.answerHint).not.toContain("still to start");
    expect(result.answerHint).not.toContain("Nothing sourced");
  });

  it("reads the window and the split off the same clock", async () => {
    state.whatsOn = {
      rows: [
        {
          id: "running",
          placeName: "The Lamb",
          kind: "quiz",
          title: "Quiz night",
          startsAt: "2026-08-15T20:00:00.000Z",
          endsAt: "2026-08-15T22:00:00.000Z",
          source: { label: "Venue site", url: "https://example.com" },
          observedAt: "2026-08-15T09:00:00.000Z",
          confidence: "listed",
        },
      ],
      kindObservedAt: {},
    };
    const tonight = await runAskTool("tonight_now", {}, ctx());
    expect(tonight.answerHint).toContain("1 on right now");

    const anotherDay = await runAskTool(
      "tonight_now",
      {},
      ctx({ now: NOW + 3 * 86_400_000 }),
    );
    expect(anotherDay.cards).toHaveLength(0);
    expect(anotherDay.answerHint).toContain("Nothing sourced");
  });

  it("degrades rather than reading a failed listing load as a quiet city", async () => {
    state.whatsOnThrows = true;
    const result = await runAskTool("tonight_now", { area: "Soho" }, ctx());
    expect(result.degraded).toBe(true);
    expect(result.answerHint).toContain("couldn't read tonight's listings");
  });

  it("degrades on a read that answered degraded, not only on one that threw", async () => {
    // The bundled read stopped throwing and started reporting itself. Zero rows
    // from a read that did not run must not answer "Nothing sourced tonight".
    state.whatsOnReadStatus = "degraded";
    const result = await runAskTool("tonight_now", { area: "Soho" }, ctx());
    expect(result.degraded).toBe(true);
    expect(result.answerHint).toContain("couldn't read tonight's listings");
    expect(result.answerHint).not.toContain("Nothing sourced");
  });
});

describe("venue_drinks", () => {
  it.each(["Drink prices at The Lamb", "Drink prices at The Lamb later?", "Drink prices this evening at The Lamb?"])("preserves the generic named-pub drink list: %s", async (query) => {
    state.venues = [venue({ id: "v1", name: "The Lamb", cheapestPrice: 5 })];
    state.prices = { prices: [price({ drinkCategory: "wine", priceGbp: 8 })], degraded: false };
    const result = await runAskTool("venue_drinks", { venueName: "The Lamb" }, ctx({ query }));
    expect(result.tool).toBe("venue_drinks");
    expect(result.cards.map((card) => card.price)).toEqual([8, 5]);
  });

  it.each([
    [{ priceObservedAt: "2026-07-03" }, "Pub menu. Source read 3 July 2026."],
    [{ priceSource: undefined, priceObservedAt: undefined }, "Publisher not recorded. Source read date unknown."],
    [{ priceObservedAt: "2026-08-16" }, "Pub menu. Source read date unknown."],
  ])("dates the listed pint card from its own row: %o", async (evidence, label) => {
    state.venues = [venue({ id: "v1", name: "The Lamb", cheapestPrice: 5, ...evidence })];
    const result = await runAskTool("venue_drinks", { venueName: "The Lamb" }, ctx({ query: "Drink prices at The Lamb" }));
    expect(result.cards.find((card) => card.key === "v1:listed")?.provenance).toEqual({ kind: "directory", label });
  });

  it.each([
    "Wine prices at The Lamb", "Prices for wine at The Lamb", "Wine costs at The Lamb", "Costs of wine at The Lamb",
    "Wine prices at The Lamb this evening?", "Wine prices now at The Lamb?", "Wine later prices at The Lamb?",
  ])("routes raw provider-selected pint pricing to recorded wine for %s", async (query) => {
    state.venues = [venue({ id: "v1", name: "The Lamb", cheapestPrice: 5 })];
    state.prices = { prices: [price({ drinkCategory: "wine", priceGbp: 8 })], degraded: false };
    const result = await runAskTool("venue_prices", { venueId: "v1" }, ctx({ query }));
    expect(result.tool).toBe("venue_drinks");
    expect(result.cards.map((card) => card.price)).toEqual([8]);
    expect(result.priceEvidence).toMatchObject([{ category: "wine", priceGbp: 8, serving: null }]);
  });

  it.each([
    "How much is a pint and food at The Lamb?",
    "How much is a pint with food at The Lamb?",
    "Burger costs in Camden",
  ])("refuses unsupported mixed, brand or serving claims at the raw tool seam: %s", async (query) => {
    state.venues = [venue({ id: "v1", name: "The Lamb", cheapestPrice: 5 })];
    const result = await runAskTool("venue_prices", { venueId: "v1" }, ctx({ query }));
    expect(result).toMatchObject({ ok: false, cards: [], proposals: [], priceEvidence: [] });
    expect(result.answerHint).toMatch(/can't|cannot|not prices for that item/i);
  });

  it("reads soft-drink category evidence without treating it as a named brand or pint", async () => {
    state.venues = [venue({ id: "v1", name: "The Lamb", cheapestPrice: 5 })];
    state.prices = {
      prices: [price({ drinkCategory: "beer", priceGbp: 5.4 }), price({ drinkCategory: "soft-drink", priceGbp: 2 })],
      degraded: false,
    };
    const result = await runAskTool("venue_prices", { venueId: "v1" }, ctx({ query: "How much is a soft drink at The Lamb?" }));
    expect(result.tool).toBe("venue_drinks");
    expect(result.cards.map((card) => card.price)).toEqual([2]);
    expect(result).toMatchObject({ priceEvidence: [{
      kind: "community-category",
      venueId: "v1",
      category: "soft-drink",
      priceGbp: 2,
      source: "community-price",
      reportedAt: NOW - 86_400_000,
      serving: null,
    }] });
  });

  it.each(["How much is a pint at The Lamb?", "How much is a pint at The Lamb now?", "How much is a pint later at The Lamb?"])("preserves named pint prices and excludes wine evidence: %s", async (query) => {
    state.venues = [venue({ id: "v1", name: "The Lamb", cheapestPrice: 5 })];
    state.prices = {
      prices: [
        price({ drinkCategory: "beer", priceGbp: 5.4, submittedAt: Date.now() }),
        price({ drinkCategory: "wine", priceGbp: 8, submittedAt: Date.now() }),
      ],
      degraded: false,
    };
    const result = await runAskTool("venue_prices", { venueId: "v1" }, ctx({ query }));
    expect(result.tool).toBe("venue_prices");
    expect(result.cards.map((card) => card.price)).toEqual([5.4, 5]);
    expect(result).toMatchObject({ priceEvidence: [
      { kind: "community-category", category: "beer", priceGbp: 5.4, serving: null },
      { kind: "listed-pint", category: "beer", priceGbp: 5, serving: "pint", reportedAt: null },
    ] });
  });

  it("requires recorded food availability for a cheapest-pint request with food", async () => {
    state.venues = [
      venue({ id: "no-food", name: "The Ship", cheapestPrice: 3 }),
      venue({ id: "food", name: "The Lamb", cheapestPrice: 5, amenities: {
        food: true, beerGarden: false, cocktails: false, liveSports: false, liveMusic: false,
      } }),
    ];
    const result = await runAskTool("cheapest_pint_near", { area: "Camden" }, ctx({ query: "Cheapest pint with food in Camden" }));
    expect(result.cards.map((card) => card.venueId)).toEqual(["food"]);
    expect(result).toMatchObject({ priceEvidence: [{ kind: "listed-pint", priceGbp: 5, serving: "pint" }] });
  });

  it("returns only recorded wine figures for an explicit wine-price lookup", async () => {
    state.venues = [venue({ id: "v1", name: "The Lamb", cheapestPrice: 5 })];
    state.prices = {
      prices: [
        price({ drinkCategory: "beer", priceGbp: 5.4 }),
        price({ drinkCategory: "wine", priceGbp: 8, corroborations: 1 }),
      ],
      degraded: false,
    };
    const result = await runAskTool("venue_drinks", { venueId: "v1", drinkCategory: "wine" }, ctx());
    expect(result.cards.map((card) => card.price)).toEqual([8]);
    expect(result.cards[0]?.provenance?.kind).toBe("community-price");
    expect(result.data).toMatchObject({ listedPint: null, drinks: [{ category: "wine", priceGbp: 8 }] });
    expect(result.answerHint).toBe("The Lamb: 1 people-logged wine figure. No accepted published drink prices match this category.");
    expect(result.provenance.some((source) => source.kind === "directory")).toBe(false);
  });

  it("states missing wine coverage instead of supplying an available pint", async () => {
    state.venues = [venue({ id: "v1", name: "The Lamb", cheapestPrice: 5 })];
    state.prices = { prices: [price({ drinkCategory: "beer", priceGbp: 5.4 })], degraded: false };
    const result = await runAskTool("venue_drinks", { venueId: "v1", drinkCategory: "wine" }, ctx());
    expect(result.cards).toEqual([]);
    expect(result.data).toMatchObject({ drinks: [], listedPint: null });
    expect(result.answerHint).toBe("No people-logged wine prices recorded at The Lamb yet. No accepted published drink prices match this category.");
    expect(result.proposals).toMatchObject([{ kind: "open_venue", venueId: "v1" }]);
  });

  it("states an unavailable category read without claiming no records", async () => {
    state.venues = [venue({ id: "v1", name: "The Lamb", cheapestPrice: 5 })];
    state.prices = { prices: [], degraded: true };
    const result = await runAskTool("venue_drinks", { venueId: "v1", drinkCategory: "wine" }, ctx());
    expect(result.cards).toEqual([]);
    expect(result.degraded).toBe(true);
    expect(result.answerHint).toBe("I couldn't read people-logged wine prices at The Lamb. No accepted published drink prices match this category.");
    expect(result.proposals).toMatchObject([{ kind: "open_venue", venueId: "v1" }]);
  });

  it.each([false, true])("keeps beer's people-logged count separate from its listed pint when degraded=%s", async (degraded) => {
    state.venues = [venue({ id: "v1", name: "The Lamb", cheapestPrice: 5 })];
    state.prices = {
      prices: [price({ drinkCategory: "beer", priceGbp: 5.4 }), price({ drinkCategory: "wine", priceGbp: 8 })],
      degraded,
    };
    const result = await runAskTool("venue_drinks", { venueId: "v1", drinkCategory: "beer" }, ctx());
    expect(result.answerHint).toBe(`${degraded ? "I couldn't read people-logged beer prices at The Lamb. " : ""}The Lamb: 1 people-logged beer figure. Listed pint: £5.00. No accepted published drink prices match this category.`);
    expect(result.cards.map((card) => [card.price, card.provenance?.kind])).toEqual([[5.4, "community-price"], [5, "directory"]]);
    expect(result.priceEvidence).toMatchObject([
      { kind: "community-category", category: "beer", priceGbp: 5.4, reportedAt: NOW - 86_400_000, serving: null },
      { kind: "listed-pint", category: "beer", priceGbp: 5, reportedAt: null, serving: "pint" },
    ]);
  });

  it.each([false, true])("retains a listed pint without claiming a people-logged figure when degraded=%s", async (degraded) => {
    state.venues = [venue({ id: "v1", name: "The Lamb", cheapestPrice: 5 })];
    state.prices = { prices: [], degraded };
    const result = await runAskTool("venue_drinks", { venueId: "v1", drinkCategory: "beer" }, ctx());
    expect(result.answerHint).toBe(`${degraded ? "I couldn't read people-logged beer prices at The Lamb." : "No people-logged beer prices recorded at The Lamb yet."} Listed pint: £5.00. No accepted published drink prices match this category.`);
    expect(result.cards).toMatchObject([{ price: 5, provenance: { kind: "directory" } }]);
    expect(result.data).toMatchObject({ status: degraded ? "unavailable" : "ready", drinks: [], listedPint: 5 });
  });

  it("refuses a brand passed as a category instead of silently reading all drinks", async () => {
    state.venues = [venue({ id: "v1", name: "The Lamb", cheapestPrice: 5 })];
    const result = await runAskTool("venue_drinks", { venueId: "v1", drinkCategory: "Coke" }, ctx());
    expect(result.ok).toBe(false);
    expect(result.cards).toEqual([]);
    expect(result.data).toBeNull();
    expect(result.answerHint).toMatch(/category is not supported/i);
  });

  it("prints one row per drink with its own tag, figure and standing", async () => {
    state.venues = [venue({ id: "v1", name: "The Lamb", cheapestPrice: 5 })];
    state.prices = {
      prices: [
        price({ drinkCategory: "beer", priceGbp: 5.4, corroborations: 2 }),
        price({ drinkCategory: "wine", priceGbp: 8, corroborations: 1 }),
      ],
      degraded: false,
    };
    const result = await runAskTool("venue_drinks", { venueId: "v1" }, ctx());
    expect(result.cards.map((card) => card.price)).toEqual([5.4, 8, 5]);
    // This lane reads no Pint Drop, so a corroborated figure states the
    // agreement and never claims the pin.
    expect(result.cards[0]?.note).toContain("two people agree on this figure");
    expect(result.cards[0]?.note).not.toContain("map");
    expect(result.cards[1]?.note).toContain("stays on this pub's page");
    expect(result.cards[2]?.provenance?.label).toBe("Pub menu. Source read 1 January 2026.");
  });

  it("resolves a routed short pub name but never a borough", async () => {
    state.venues = [
      venue({ id: "lamb", name: "The Lamb", area: "Camden", cheapestPrice: 4 }),
      venue({ id: "head", name: "Camden Head", area: "Camden", cheapestPrice: 5 }),
    ];
    const named = await runAskTool("venue_drinks", { venueName: "Lamb" }, ctx());
    expect(named.ok).toBe(true);
    expect(named.data).toMatchObject({ venueId: "lamb" });

    const areaWord = await runAskTool("venue_drinks", { venueName: "Camden" }, ctx());
    expect(areaWord.ok).toBe(false);
    expect(areaWord.answerHint).toContain("Name a listed pub");
    expect(areaWord.cards).toHaveLength(0);
  });

  it("says nobody has logged one rather than inventing a figure", async () => {
    state.venues = [venue({ id: "v1", name: "The Lamb", cheapestPrice: null })];
    const result = await runAskTool("venue_drinks", { venueId: "v1" }, ctx());
    expect(result.cards).toHaveLength(0);
    expect(result.answerHint).toContain("No drink prices logged at The Lamb yet");
  });

  it("separates a failed read from an unlogged pub", async () => {
    state.venues = [venue({ id: "v1", name: "The Lamb", cheapestPrice: null })];
    state.prices = { prices: [], degraded: true };
    const result = await runAskTool("venue_drinks", { venueId: "v1" }, ctx());
    expect(result.degraded).toBe(true);
    expect(result.answerHint).toContain("couldn't read what people have logged");
  });

  it("still names the failed read when a listed pint is on record", async () => {
    state.venues = [venue({ id: "v1", name: "The Lamb", cheapestPrice: 5 })];
    state.prices = { prices: [], degraded: true };
    const result = await runAskTool("venue_drinks", { venueId: "v1" }, ctx());
    expect(result.degraded).toBe(true);
    expect(result.answerHint).toContain("couldn't read what people have logged");
    expect(result.cards.map((card) => card.price)).toEqual([5]);
    expect(result.cards[0]?.provenance?.label).toBe("Pub menu. Source read 1 January 2026.");
  });
});

describe("find_desk", () => {
  it("says no seat data yet while the pack carries no work-friendly rows", async () => {
    state.desk = { venues: [], status: "ready" };
    const result = await runAskTool("find_desk", { area: "Angel" }, ctx());
    expect(result.ok).toBe(true);
    expect(result.cards).toHaveLength(0);
    expect(result.answerHint).toContain("No seat data yet");
    expect(result.answerHint).not.toContain("Tyburnia");
  });

  it("never asserts absence in an area the places list does not name", async () => {
    state.desk = {
      status: "ready",
      venues: [
        { id: "c1", name: "Bean Counter", area: "Islington", lat: 51.53, lng: -0.1, kind: "cafe" },
      ],
    };
    const result = await runAskTool("find_desk", { area: "Angel" }, ctx());
    expect(result.cards).toHaveLength(0);
    expect(result.answerHint).not.toContain("No seat data yet");
    expect(result.answerHint).toContain("Angel");
    expect(result.answerHint).toMatch(/don't know an area/i);
  });

  it("answers from work-friendly rows and still admits the missing facts", async () => {
    state.desk = {
      status: "ready",
      venues: [
        { id: "c1", name: "Bean Counter", area: "Angel", lat: 51.53, lng: -0.1, kind: "cafe" },
      ],
    };
    const result = await runAskTool("find_desk", { area: "Angel" }, ctx());
    expect(result.cards).toHaveLength(1);
    expect(result.cards[0]?.note).toContain("no seat or wifi report on record");
    expect(result.answerHint).toContain("No seat or wifi report on any of them yet.");
  });

  it("degrades when the pack could not be read", async () => {
    state.desk = { venues: [], status: "unavailable" };
    const result = await runAskTool("find_desk", {}, ctx());
    expect(result.degraded).toBe(true);
    expect(result.answerHint).toContain("couldn't read the places list");
  });
});

describe("report_occupancy", () => {
  it("proposes a crowd report and writes nothing until confirm", async () => {
    state.venues = [venue({ id: "v1", name: "The Lamb" })];
    const result = await runAskTool(
      "report_occupancy",
      { venueName: "The Lamb", level: "rammed" },
      ctx(),
    );
    expect(result.ok).toBe(true);
    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0]).toMatchObject({
      kind: "report_occupancy",
      venueId: "v1",
      level: "full",
    });
    expect(result.answerHint).toContain("Nothing is saved until you confirm.");
  });

  it("asks which pub before taking a report", async () => {
    state.venues = [venue({ id: "v1", name: "The Lamb" })];
    const result = await runAskTool("report_occupancy", { level: "full" }, ctx());
    expect(result.ok).toBe(false);
    expect(result.answerHint).toContain("Name the pub");
  });

  it("refuses a place word that would only land on a pub by prefix", async () => {
    // Each of these SHARES its first word with a London place. A district word
    // may not become the pub on the other side of the city.
    state.venues = [
      venue({ id: "angel", name: "The Angel Hillingdon", area: "Hillingdon" }),
      venue({ id: "mayfair", name: "The Mayfair Tavern", area: "Wandsworth" }),
      venue({ id: "clapham", name: "The Clapham North", area: "Lambeth" }),
    ];

    const occ = await runAskTool(
      "report_occupancy",
      { venueName: "Angel", level: "it's rammed" },
      ctx(),
    );
    expect(occ.answerHint).toContain("Name the pub");
    expect(occ.answerHint).not.toContain("The Angel Hillingdon");

    const drinks = await runAskTool("venue_drinks", { venueName: "Mayfair" }, ctx());
    expect(drinks.answerHint).toBe(VENUE_DRINKS_NO_VENUE);

    const clapham = await runAskTool(
      "report_occupancy",
      { venueName: "Clapham", level: "it's rammed" },
      ctx(),
    );
    expect(clapham.answerHint).not.toContain("The Clapham North");
    expect(clapham.answerHint).toContain("Name the pub");
  });

  it("still answers a pub whose whole name is a place word", async () => {
    // The router strips "the" before a tool sees the name, so "The Angel"
    // arrives as "Angel". An EXACT name, article or not, is the pub they named.
    state.venues = [
      venue({ id: "angel", name: "The Angel", area: "Islington" }),
      venue({ id: "lamb", name: "The Lamb", area: "Camden" }),
    ];

    const [call] = routeAskDeterministically("It's rammed at The Angel");
    expect(call?.name).toBe("report_occupancy");
    const occ = await runAskTool("report_occupancy", defined(call).args, ctx());
    expect(occ.answerHint).toContain("Log The Angel as full");

    const drinks = await runAskTool("venue_drinks", { venueName: "Angel" }, ctx());
    expect(drinks.answerHint).not.toBe(VENUE_DRINKS_NO_VENUE);
    expect(drinks.answerHint).toContain("The Angel");
  });

  it("takes a report for the pub named, never a borough's name-alike", async () => {
    state.venues = [
      venue({ id: "lamb", name: "The Lamb", area: "Camden" }),
      venue({ id: "head", name: "Camden Head", area: "Camden" }),
    ];

    const [areaCall] = routeAskDeterministically("It's rammed in Camden");
    expect(areaCall?.name).toBe("report_occupancy");
    const areaResult = await runAskTool("report_occupancy", defined(areaCall).args, ctx());
    expect(areaResult.answerHint).not.toContain("Camden Head");
    expect(areaResult.answerHint).toContain("Name the pub");

    const [pubCall] = routeAskDeterministically("It's rammed in The Lamb");
    const pubResult = await runAskTool("report_occupancy", defined(pubCall).args, ctx());
    expect(pubResult.answerHint).toContain("Log The Lamb as full");
  });

  it("asks for the level when the words carry none", async () => {
    state.venues = [venue({ id: "v1", name: "The Lamb" })];
    const result = await runAskTool(
      "report_occupancy",
      { venueName: "The Lamb", level: "mustard" },
      ctx(),
    );
    expect(result.answerHint).toBe("Is The Lamb empty, some seats, or full?");
  });
});


describe("venue_prices read availability", () => {
  it.each([false, true])("requires a complete community read before estimating when degraded=%s", async (degraded) => {
    state.venues = [venue({ id: "unpriced-test-pub", name: "Unpriced Arms", cheapestPrice: null, zone: 2 })];
    state.prices = { prices: [], degraded };
    const result = await runAskTool("venue_prices", { venueId: "unpriced-test-pub" }, ctx());
    expect(result.data).toMatchObject({
      communityDegraded: degraded,
      zoneEstimate: degraded ? null : { estimateGbp: 5.75, zone: 2, sampleSize: 301 },
    });
    if (degraded) {
      expect(result.degraded).toBe(true);
      expect(result.answerHint).toContain("couldn't read");
      expect(result.answerHint).not.toContain("no corroborated");
      expect(result.cards[0]?.note).toContain("couldn't read");
      expect(result.cards[0]?.note).not.toContain("No recorded pint");
    } else {
      expect(result.answerHint).toContain("Estimate £5.75");
    }
  });

  it("retains recorded prices when a community read fails", async () => {
    state.venues = [venue({ id: "priced-test-pub", name: "Listed Arms", cheapestPrice: 5, zone: 2 })];
    state.prices = { prices: [], degraded: true };
    const result = await runAskTool("venue_prices", { venueId: "priced-test-pub" }, ctx());
    expect(result.data).toMatchObject({ curatedPrice: 5, zoneEstimate: null });
    expect(result.cards[0]?.price).toBe(5);
    expect(result.answerHint).toContain("couldn't read");
    expect(result.answerHint).toContain("listed pint £5.00");
    expect(result.answerHint).not.toContain("no corroborated");
  });

  it("dates a people-logged price by its London day", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: NOW });
    try {
      state.venues = [venue({ id: "v1", name: "The Lamb", cheapestPrice: 5 })];
      // 00:30 BST on 15 August is still 14 August in UTC.
      state.prices = { prices: [price({ submittedAt: Date.parse("2026-08-14T23:30:00.000Z") })], degraded: false };
      const result = await runAskTool("venue_prices", { venueId: "v1" }, ctx());
      expect(result.cards.map((card) => card.note)).toContain("beer · people-logged 2026-08-15");
    } finally {
      vi.useRealTimers();
    }
  });
});
