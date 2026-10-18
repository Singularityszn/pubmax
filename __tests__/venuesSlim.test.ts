import { readFileSync, statSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  filterVenues,
  stableVenueIdFromKey,
  venueGroupingKey,
  groupVenuePrices,
  type Filters,
  type VenuePrice,
} from "@/lib/venues";
import {
  CURATED_CUISINE_BY_VENUE_ID,
  normaliseCuisineTags,
} from "@/lib/cuisineTags";
import { slimVenueToPin } from "@/lib/slimPins";
import { CITIES } from "@/lib/cities";
import { loadSlimVenuesFromPathResult, SLIM_VENUES_PATH, type SlimVenue } from "@/lib/venuesSlim";
import { offlineCache } from "@/lib/offlineCache";
import {
  expectedSlimFamousCounts,
  famousSeedLapsedAt,
  famousVenueLeadBudgetHours,
  slimPayloadGeneratedAt,
} from "@/__tests__/helpers/currentFamousVenues";
import { cheapestPriceReadDay } from "@/lib/priceReadDay.mjs";
import { defined } from "@/__tests__/helpers/defined";
import { pubsToGeoJSON } from "@/components/map/canvas/geojson";
import { hoverCardCopy } from "@/components/map/canvas/hoverCard";
import { buildMapVenueListModel, mapVenueListCheapest } from "@/lib/mapVenueList";
import { buildLogNearbyCandidates } from "@/lib/mapLogIntent";
import { deriveMapRenderedState } from "@/lib/mapRenderedState";
import { priceBucket } from "@/lib/communityPrice";

// Guards the built public/data/venues_slim.json — the ~400 KB file the map
// loads instead of the ~6 MB raw dataset (scripts/build_slim_index.mjs). The
// script MIRRORS lib/venues.ts's grouping/id logic in plain JS; the id-match
// test below re-derives ids from the real TS off the raw rows, so any drift
// between the mirror and the canonical logic fails here.

const ROOT = path.resolve(__dirname, "..");
const SLIM_PATH = path.join(ROOT, "public", "data", "venues_slim.json");
const RAW_PATH = path.join(
  ROOT,
  "public",
  "data",
  "pint_prices_app_dataset.json",
);
const SLIM_KEYS = [
  "borough",
  "cheapestPrice",
  "filterHints",
  "id",
  "lat",
  "lng",
  "locality",
  "name",
];

const slimPayload = JSON.parse(readFileSync(SLIM_PATH, "utf8")) as unknown;
const slim = (
  slimPayload && typeof slimPayload === "object" && !Array.isArray(slimPayload)
    ? (slimPayload as { rows?: unknown }).rows
    : slimPayload
) as SlimVenue[];
const rawRows = JSON.parse(readFileSync(RAW_PATH, "utf8")) as VenuePrice[];
const famousIds = new Set(
  slim
    .filter((venue) => venue.anchorLabel !== undefined)
    .map((venue) => venue.id),
);
const fullVenuesById = new Map(
  groupVenuePrices(rawRows)
    .filter((venue) => !famousIds.has(venue.id))
    .map((venue) => [venue.id, venue]),
);

// The source dataset is London-*centred* but not London-*bounded*: ~19% of rows
// carry coords well outside Greater London (mis-geocoded entries the raw feed
// already ships and the existing map already renders). So the coordinate test
// asserts SANE, finite lat/lng in valid geographic range — the real thing a
// guard protects against (a NaN, a lat/lng swap, an empty-string coord) — rather
// than a tight London box the raw data provably doesn't satisfy. A separate
// assertion confirms the bulk still cluster around London, so the slim build
// can't have silently mangled the coordinate column.
const VALID_COORDS = { minLat: -90, maxLat: 90, minLng: -180, maxLng: 180 };
const LONDON = { lat: 51.5, lng: -0.12 };

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function serveSlimPayload(payload: unknown) {
  vi.spyOn(offlineCache, "get").mockReset().mockResolvedValue(null);
  vi.spyOn(offlineCache, "set").mockReset().mockResolvedValue(true);
  const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => payload });
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}

function makeFilters(overrides: Partial<Filters> = {}): Filters {
  return {
    query: "",
    maxPrice: 100,
    crawlStyle: "balanced",
    stopCount: 4,
    routeWindow: 90,
    requireBeerGarden: false,
    requireNonAlcoholic: false,
    requireLiveSports: false,
    requireFood: false,
    requireCocktails: false,
    requireWater: false,
    requireHeritage: false,
    requirePintDrops: false,
    canonicalOnly: false,
    openNow: false,
    requireStepFree: false,
    requireAccessibleToilet: false,
    requireSeatedService: false,
    drinkCategory: "",
    drinkBrand: "",
    drinkSubtype: "",
    topShelfOnly: false,
    zone: "",
    ...overrides,
  };
}

function matchingIdsFromSlim(filters: Filters): string[] {
  return (slim as SlimVenue[])
    .filter((venue) => venue.anchorLabel === undefined)
    .filter(
      (venue) => filterVenues([slimVenueToPin(venue)], filters).length > 0,
    )
    .map((venue) => venue.id)
    .sort();
}

function matchingIdsFromFull(filters: Filters): string[] {
  return Array.from(fullVenuesById.values())
    .filter((venue) => filterVenues([venue], filters).length > 0)
    .map((venue) => venue.id)
    .sort();
}

describe("slim legacy and curated price boundaries", () => {
  it("marks only bars derived from the committed legacy records", () => {
    const marked = slim.filter((row) => row.legacyOsmBar === true);
    expect(marked).toHaveLength(147);
    for (const row of slim) {
      expect(row.legacyOsmBar, row.id).toBe(
        fullVenuesById.get(row.id)?.kind === "bar" ? true : undefined,
      );
    }
  });

  it.each(["venue-1uvk466", "venue-8rf7pi", "venue-fw3cy8"])("preserves %s evidence through normalization and offline reads", async (id) => {
    const row = defined(slim.find((row) => row.id === id));
    const payload = { revision: "legacy-roundtrip", rows: [row] };
    const url = "/data/legacy-roundtrip.json";
    let stored: unknown = null;
    serveSlimPayload(payload);
    vi.mocked(offlineCache.set).mockImplementation(async (_key, value) => {
      stored = value;
      return true;
    });
    expect(await loadSlimVenuesFromPathResult(url, { expectedRevision: payload.revision }))
      .toEqual({ rows: [row], status: "ready" });
    expect(stored).toEqual(payload);
    vi.mocked(offlineCache.get).mockImplementation(async <T>() => stored as T);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    expect(await loadSlimVenuesFromPathResult(url, { expectedRevision: payload.revision }))
      .toEqual({ rows: [row], status: "ready" });
  });

  it.each([
    { legacyOsmBar: undefined },
    { legacyOsmBar: false },
    { legacyOsmBar: "true" },
    { priceSource: undefined },
    { priceSource: " " },
    { priceObservedAt: undefined },
    { priceObservedAt: "invalid" },
    { priceBand: 0 },
    { anchorLabel: "Pint" },
    { anchorObservedAt: "2026-07-18" },
    { anchorSourceUrl: "https://example.com/menu" },
    { anchorCourse: "main" },
    { kind: "pub" },
    { kind: "food" },
    { kind: "restaurant" },
    { id: "bar-unverified" },
  ])("rejects unsupported legacy price claims: %j", async (claim) => {
    const legacy = defined(slim.find((row) => row.id === "venue-1uvk466"));
    const payload = { revision: "legacy-invalid", rows: [{ ...legacy, ...claim }] };
    const fetcher = serveSlimPayload(payload);
    expect(await loadSlimVenuesFromPathResult("/data/legacy-invalid.json", {
      expectedRevision: payload.revision,
    })).toEqual({ rows: [], status: "unavailable" });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(offlineCache.set).not.toHaveBeenCalled();
  });

  it.each(["bar", "food", "restaurant"])("preserves complete %s anchors and rejects malformed anchors", async (kind) => {
    const row = defined(slim.find((row) => row.kind === kind && row.anchorLabel !== undefined));
    const payload = { revision: "curated-anchor", rows: [row] };
    serveSlimPayload(payload);
    expect(await loadSlimVenuesFromPathResult("/data/curated-valid.json", {
      expectedRevision: payload.revision,
    })).toEqual({ rows: [row], status: "ready" });
    const withoutAnchor = { ...row };
    delete withoutAnchor.anchorLabel;
    delete withoutAnchor.anchorCourse;
    delete withoutAnchor.anchorObservedAt;
    delete withoutAnchor.anchorSourceUrl;
    const invalid: unknown[] = [
      withoutAnchor,
      { ...withoutAnchor, legacyOsmBar: true },
      { ...row, anchorLabel: undefined },
      { ...row, anchorObservedAt: undefined },
      { ...row, anchorSourceUrl: undefined },
      { ...row, anchorLabel: " " },
      { ...row, anchorObservedAt: " " },
      { ...row, anchorSourceUrl: " " },
      { ...row, anchorLabel: 42 },
      { ...row, anchorObservedAt: 42 },
      { ...row, anchorSourceUrl: 42 },
      { ...row, anchorCourse: "invalid" },
    ];
    if (kind === "restaurant") invalid.push({ ...row, anchorCourse: undefined });
    for (const broken of invalid) {
      const fetcher = serveSlimPayload({ ...payload, rows: [broken] });
      expect(await loadSlimVenuesFromPathResult("/data/curated-invalid.json", {
        expectedRevision: payload.revision,
      }), JSON.stringify(broken)).toEqual({ rows: [], status: "unavailable" });
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(offlineCache.set).not.toHaveBeenCalled();
    }
  });
});

describe("slim listed price evidence", () => {
  it("keeps the exact cheapest row's publisher and source read on the shipped projection", () => {
    const row = slim.find((venue) => venue.id === "venue-p7p18j") as SlimVenue & Record<string, unknown>;
    const prices = defined(fullVenuesById.get("venue-p7p18j")?.prices);
    expect(row).toMatchObject({
      cheapestPrice: 2.95,
      priceSource: "Pint Prices",
      priceObservedAt: cheapestPriceReadDay(prices, row.cheapestPrice),
    });
  });
});

describe("legacy bar pint map semantics", () => {
  const legacyPrices = [
    { id: "venue-8rf7pi", price: 6, pinLabel: "£6", listLabel: "£6.00" },
    { id: "venue-1uvk466", price: 5, pinLabel: "£5", listLabel: "£5.00" },
    { id: "venue-fw3cy8", price: 3.6, pinLabel: "£3.60", listLabel: "£3.60" },
  ];

  describe.each(["full", "slim"] as const)("%s records", (representation) => {
    function venueFor(id: string) {
      return representation === "full"
        ? defined(fullVenuesById.get(id))
        : slimVenueToPin(defined(slim.find((row) => row.id === id)));
    }

    it.each(legacyPrices)("filters the recorded pint at $id", ({ id, price }) => {
      const venue = venueFor(id);
      expect(venue.kind).toBe("bar");
      expect(filterVenues([venue], makeFilters({ maxPrice: price - 0.5 }))).toEqual([]);
      expect(filterVenues([venue], makeFilters({ maxPrice: price }))).toEqual([venue]);
    });

    it.each(legacyPrices)("labels the recorded pint on hover at $id", ({ id, price }) => {
      expect(hoverCardCopy(venueFor(id), undefined, null)).toMatchObject({
        venueTypeLabel: "Bar", price, priceSuffix: "cheapest pint", detailLabel: "venue detail",
      });
    });

    it.each(legacyPrices)("prints pin and cluster pint figures at $id", ({ id, price, pinLabel }) => {
      const properties = pubsToGeoJSON([venueFor(id)], new Map(), null).features[0]?.properties;
      expect(properties).toMatchObject({ kind: "bar", priceLabel: pinLabel, clusterPrice: price });
    });

    it.each(legacyPrices)("uses pint meaning in the rendered legend at $id", ({ id, price }) => {
      const data = pubsToGeoJSON([venueFor(id)], new Map(), null);
      expect(deriveMapRenderedState(data, { brass: "brass" }, null)).toMatchObject({
        priceBands: [{ meaning: "pint", bucket: priceBucket(price) }], clusterPrices: true,
      });
    });

    it.each(legacyPrices)("shows and sorts the pint price in lists at $id", ({ id, price, listLabel }) => {
      const venue = venueFor(id);
      expect.soft(buildMapVenueListModel([venue], null).rows[0]).toMatchObject({
        kind: "bar", priceLabel: listLabel, anchor: null,
      });
      expect.soft(mapVenueListCheapest([venue])).toEqual({ venue, priceGbp: price });
      expect.soft(buildLogNearbyCandidates([venue])[0]).toMatchObject({
        kind: "bar", priceLabel: listLabel, anchor: null,
      });
    });
  });

  it("applies a GBP5.50 maximum to Tattoo Bar's GBP6 pint", () => {
    const venue = slimVenueToPin(defined(slim.find((row) => row.id === "venue-8rf7pi")));
    expect(filterVenues([venue], makeFilters({ maxPrice: 5.5 }))).toEqual([]);
  });

  it("retains curated bar anchor semantics", () => {
    const row = defined(slim.find((row) => row.id === "bar-american-bar-savoy"));
    const venue = slimVenueToPin(row);
    expect(filterVenues([venue], makeFilters({ maxPrice: 5.5 }))).toEqual([venue]);
    expect(hoverCardCopy(venue, undefined, null)).toMatchObject({
      price: 25, priceSuffix: "Welcome to The Savoy", priceBand: null,
    });
    const data = pubsToGeoJSON([venue], new Map(), null);
    expect(data.features[0]?.properties?.priceLabel).toBeUndefined();
    expect(data.features[0]?.properties?.clusterPrice).toBeUndefined();
    expect(deriveMapRenderedState(data, { brass: "brass" }, null)).toMatchObject({
      priceBands: [{ meaning: "type-relative", bucket: 2 }], clusterPrices: false,
    });
    expect(buildMapVenueListModel([venue], null).rows[0]).toMatchObject({
      priceLabel: "£25.00", anchor: { label: "Welcome to The Savoy" },
    });
    expect(buildLogNearbyCandidates([venue])[0]).toMatchObject({
      priceLabel: "£25.00", anchor: { label: "Welcome to The Savoy" },
    });
  });
});

describe("venues_slim.json", () => {
  it("carries Hatton Garden as reader area while retaining Camden borough", () => {
    const hatton = slim.find((venue) => venue.name === "The Sir Christopher Hatton");
    expect(hatton?.locality).toBe("Hatton Garden");
    expect(hatton?.borough).toBe("Camden");
    expect(hatton ? slimVenueToPin(hatton).locality : undefined).toBe("Hatton Garden");
  });

  it("is the payload URL used by the map loader", () => {
    expect(SLIM_VENUES_PATH).toBe("/data/venues_slim.json");
    expect(CITIES.london.slimVenuesPath).toBe(SLIM_VENUES_PATH);
  });

  it("non-London cities point at /data/cities/{id}/venues_slim.json", () => {
    expect(CITIES.manchester.slimVenuesPath).toBe(
      "/data/cities/manchester/venues_slim.json",
    );
    expect(CITIES.glasgow.slimVenuesPath).toBe(
      "/data/cities/glasgow/venues_slim.json",
    );
  });

  it("parses to a non-empty array", () => {
    expect(Array.isArray(slim)).toBe(true);
    expect((slim as unknown[]).length).toBeGreaterThan(0);
  });

  it("contains only the fields the map hydration path consumes", () => {
    const rows = slim as Record<string, unknown>[];
    const badKeySets = rows
      // `zone` (nearest-station fare zone) is an optional additive field — strip
      // it before the exact-shape check so both zoned and unknown-zone rows pass.
      .map((row) =>
        Object.keys(row)
          .filter(
            (key) =>
              ![
                "zone",
                "priceSource",
                // The day the cheapest figure was last read (lib/priceReadDay.mjs).
                "priceObservedAt",
                "kind",
                "legacyOsmBar",
                "priceBand",
                "anchorLabel",
                "anchorCourse",
                "anchorObservedAt",
                "anchorSourceUrl",
              ].includes(key),
          )
          .sort(),
      )
      .filter((keys) => JSON.stringify(keys) !== JSON.stringify(SLIM_KEYS));
    expect(badKeySets).toEqual([]);
  });

  it("loads every shipped row through the public parser", async () => {
    serveSlimPayload(slimPayload);
    const result = await loadSlimVenuesFromPathResult(SLIM_VENUES_PATH, {
      expectedRevision: (slimPayload as { revision: string }).revision,
    });
    expect(result.status).toBe("ready");
    expect(result.rows.map((row) => row.id)).toEqual(slim.map((row) => row.id));
  });

  it.each([
    ["51.500_0.000", 21, "venue-1uvk466"],
    ["51.500_0.025", 8, "venue-8rf7pi"],
    ["51.575_-0.100", 22, "venue-fw3cy8"],
  ])("keeps every venue in cold cell %s", async (cell, count, barId) => {
    const url = `/data/venues_slim.cell.${cell}.json`;
    const payload = JSON.parse(readFileSync(path.join(ROOT, "public", url), "utf8")) as {
      revision: string;
      rows: SlimVenue[];
    };
    const fetcher = serveSlimPayload(payload);
    expect(payload.rows).toHaveLength(count);
    const parsed = await loadSlimVenuesFromPathResult(url);
    expect.soft(parsed.status).toBe("ready");
    expect.soft(parsed.rows.map((row) => row.id)).toEqual(payload.rows.map((row) => row.id));
    const cold = await loadSlimVenuesFromPathResult(url, { expectedRevision: payload.revision });
    expect.soft(cold.status).toBe("ready");
    expect.soft(cold.rows.map((row) => row.id)).toEqual(payload.rows.map((row) => row.id));
    for (const source of payload.rows) {
      const loaded = cold.rows.find((row) => row.id === source.id);
      expect.soft(loaded, source.id).toMatchObject({
        id: source.id,
        lat: source.lat,
        lng: source.lng,
        cheapestPrice: source.cheapestPrice,
        ...(source.priceSource ? { priceSource: source.priceSource } : {}),
        ...(source.priceObservedAt ? { priceObservedAt: source.priceObservedAt } : {}),
      });
    }
    expect.soft(cold.rows.find((row) => row.id === barId)?.kind).toBe("bar");
    expect.soft(fetcher).toHaveBeenCalledTimes(2);
  });

  it("carries complete anchor provenance for famous non-pub venues", () => {
    const famous = (slim as SlimVenue[]).filter(
      (row) =>
        row.anchorLabel !== undefined,
    );
    expect(famous).toHaveLength(expectedSlimFamousCounts().total);
    for (const row of famous) {
      expect(row.anchorLabel?.trim()).toBeTruthy();
      expect(row.anchorObservedAt?.trim()).toBeTruthy();
      expect(row.anchorSourceUrl?.trim()).toBeTruthy();
    }
  });

  it("every venue has finite coordinates in valid geographic range", () => {
    const rows = slim as SlimVenue[];
    for (const v of rows) {
      expect(Number.isFinite(v.lat)).toBe(true);
      expect(Number.isFinite(v.lng)).toBe(true);
      expect(v.lat).toBeGreaterThanOrEqual(VALID_COORDS.minLat);
      expect(v.lat).toBeLessThanOrEqual(VALID_COORDS.maxLat);
      expect(v.lng).toBeGreaterThanOrEqual(VALID_COORDS.minLng);
      expect(v.lng).toBeLessThanOrEqual(VALID_COORDS.maxLng);
    }
  });

  it("the bulk of venues cluster around London (coord column not mangled)", () => {
    // Not every row is in London (see note above), but if the build had swapped
    // or corrupted the coordinate column the median would drift off London. A
    // majority within ~0.5° of central London proves the column survived intact.
    const rows = slim as SlimVenue[];
    const nearLondon = rows.filter(
      (v) =>
        Math.abs(v.lat - LONDON.lat) < 0.5 &&
        Math.abs(v.lng - LONDON.lng) < 0.5,
    );
    expect(nearLondon.length).toBeGreaterThan(rows.length * 0.5);
  });

  it("ids are unique", () => {
    const rows = slim as SlimVenue[];
    const ids = new Set(rows.map((v) => v.id));
    expect(ids.size).toBe(rows.length);
  });

  it("cheapestPrice is a positive number or null", () => {
    const rows = slim as SlimVenue[];
    for (const v of rows) {
      if (v.cheapestPrice !== null) {
        expect(v.cheapestPrice).toBeGreaterThan(0);
      }
    }
  });

  it("carries compact filter hints for the fast map path", () => {
    const rows = slim as SlimVenue[];
    expect(
      rows.some((row) => row.filterHints?.searchText.includes("wine")),
    ).toBe(true);
    expect(rows.some((row) => row.filterHints?.amenities.cocktails)).toBe(true);
    expect(rows.some((row) => row.filterHints?.amenities.nonAlcoholic)).toBe(
      true,
    );
    expect(
      rows.some((row) =>
        (row.filterHints?.drinkCategories ?? []).includes("beer"),
      ),
    ).toBe(true);
    expect(
      rows.some((row) =>
        (row.filterHints?.drinkBrands ?? []).includes("guinness"),
      ),
    ).toBe(true);
    expect(
      rows.some((row) => row.filterHints?.drinkText?.includes("guinness")),
    ).toBe(true);
  });

  it("keeps locality separate from the slim address search contract", () => {
    const hatton = slim.find((row) => row.name === "The Sir Christopher Hatton");
    expect(hatton?.locality).toBe("Hatton Garden");
    expect(hatton?.filterHints?.searchText).not.toContain("hatton garden");
  });

  it("drink-lens filters use slim drinkCategories / drinkBrands hints", () => {
    const ginIds = matchingIdsFromSlim(makeFilters({ drinkCategory: "gin" }));
    const guinnessIds = matchingIdsFromSlim(
      makeFilters({ drinkBrand: "guinness" }),
    );
    expect(ginIds.length).toBeGreaterThan(0);
    expect(guinnessIds.length).toBeGreaterThan(0);
    // Hints are the fast path — every gin hit should carry a gin category hint
    // or gin token in searchText (never invent matches from nowhere).
    const byId = new Map((slim as SlimVenue[]).map((row) => [row.id, row]));
    for (const id of ginIds.slice(0, 20)) {
      const hints = byId.get(id)?.filterHints;
      expect(hints).toBeTruthy();
      const fromHint = (hints?.drinkCategories ?? []).includes("gin");
      const fromText = (hints?.searchText ?? "").includes("gin");
      expect(fromHint || fromText).toBe(true);
    }
  });

  it.each([
    [
      "stout",
      makeFilters({ drinkCategory: "beer", drinkSubtype: "beer-stout" }),
    ],
    [
      "lager",
      makeFilters({ drinkCategory: "beer", drinkSubtype: "beer-lager" }),
    ],
    ["IPA", makeFilters({ drinkCategory: "beer", drinkSubtype: "beer-ipa" })],
  ])(
    "matches hydrated filtering for the %s drink refinement",
    (_label, filters) => {
      const slimIds = matchingIdsFromSlim(filters);
      expect(slimIds.length).toBeGreaterThan(0);
      expect(slimIds).toEqual(matchingIdsFromFull(filters));
    },
  );

  it("matches hydrated filtering for the top shelf refinement", () => {
    // The pint dataset is beer-only and ordinary pints never classify as top
    // shelf (no marketing-adjective promotion), so both paths may legitimately
    // return nothing — the contract under test is slim/full agreement.
    const filters = makeFilters({ drinkCategory: "beer", topShelfOnly: true });
    expect(matchingIdsFromSlim(filters)).toEqual(matchingIdsFromFull(filters));
  });

  it("carries every curated cuisine hint from the app cuisine source", () => {
    const byId = new Map((slim as SlimVenue[]).map((row) => [row.id, row]));
    for (const [id, rawTags] of Object.entries(CURATED_CUISINE_BY_VENUE_ID)) {
      const venue = byId.get(id);
      if (!venue) continue;
      const expectedTags = normaliseCuisineTags(rawTags);
      const shippedTags = venue?.filterHints?.cuisineTags ?? [];
      for (const tag of expectedTags) {
        expect(shippedTags, `${id} missing cuisine tag ${tag}`).toContain(tag);
      }
    }
  });

  it.each([
    ["wine query", makeFilters({ query: "wine" })],
    ["cocktail filter", makeFilters({ requireCocktails: true })],
    ["low/no filter", makeFilters({ requireNonAlcoholic: true })],
    ["water filter", makeFilters({ requireWater: true })],
    ["heritage filter", makeFilters({ requireHeritage: true })],
    ["canonical filter", makeFilters({ canonicalOnly: true })],
  ])("matches hydrated filtering for %s", (_label, filters) => {
    expect(matchingIdsFromSlim(filters)).toEqual(matchingIdsFromFull(filters));
  });

  it("slim ids equal the canonical stableVenueIdFromKey(venueGroupingKey(...))", () => {
    // Re-derive every id from the RAW rows using the real TS grouping/id logic,
    // then confirm a spread of slim ids (first / middle / last, plus a random
    // sample) each resolves to a raw group. Proves the .mjs mirror stays exact.
    const canonicalIds = new Set(
      rawRows.map((row) => stableVenueIdFromKey(venueGroupingKey(row))),
    );
    for (const id of famousIds) canonicalIds.delete(id);
    // Famous venue seed rows have editorial ids; legacy pub rows retain the
    // canonical raw-dataset identity contract.
    const rows = (slim as SlimVenue[]).filter((row) => row.anchorLabel === undefined);
    expect(canonicalIds.size).toBe(rows.length);
    const sampleIdx = new Set<number>([
      0,
      Math.floor(rows.length / 2),
      rows.length - 1,
    ]);
    for (let i = 0; i < 10; i += 1) {
      sampleIdx.add(Math.floor((rows.length / 10) * i));
    }
    for (const idx of sampleIdx) {
      const v = defined(rows[idx]);
      expect(canonicalIds.has(v.id)).toBe(true);
    }

    // And the whole set matches, not just the sample.
    const slimIds = new Set(rows.map((v) => v.id));
    expect(slimIds).toEqual(canonicalIds);
  });

  it("counts famous rows as of the slim payload clock, not the wall clock", () => {
    const lapsedAt = famousSeedLapsedAt();
    vi.useFakeTimers();
    vi.setSystemTime(lapsedAt);
    try {
      const famous = (slim as SlimVenue[]).filter(
        (row) => row.anchorLabel !== undefined,
      );
      expect(famous).toHaveLength(expectedSlimFamousCounts().total);
      expect(expectedSlimFamousCounts(lapsedAt).total).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("asks the freshness gate to alarm two weeks before those rows expire", () => {
    const registry = JSON.parse(
      readFileSync(path.join(ROOT, "data", "freshness_registry.json"), "utf8"),
    ) as {
      datasets: Array<{
        id: string;
        artifact: string | null;
        stalenessBudgetHours: number | null;
        stamp: { kind: string; value?: string };
      }>;
    };
    const entry = registry.datasets.find((dataset) => dataset.id === "famous_venues");
    const generatedAt = slimPayloadGeneratedAt();
    expect(entry).toMatchObject({
      artifact: "public/data/venues_slim.json",
      class: "episodic",
      stamp: { kind: "literal", value: generatedAt.toISOString() },
      stalenessBudgetHours: famousVenueLeadBudgetHours(generatedAt),
    });
  });

  it("ships exact curated pack counts with every type-relative band", () => {
    const rows = slim as SlimVenue[];
    const bars = rows.filter((row) => row.kind === "bar" && row.anchorLabel !== undefined);
    const food = rows.filter((row) => row.kind === "food");
    const restaurants = rows.filter((row) => row.kind === "restaurant");
    const expected = expectedSlimFamousCounts();
    expect(bars).toHaveLength(expected.bar);
    expect(food).toHaveLength(expected.food);
    expect(restaurants).toHaveLength(expected.restaurant);
  });

  it("is meaningfully smaller than the raw dataset", () => {
    const slimBytes = statSync(SLIM_PATH).size;
    const rawBytes = statSync(RAW_PATH).size;
    // The whole point of the split: the full slim index must be a small
    // fraction of raw. (This monolith is the server/by-id artifact; the map's
    // FIRST-PAINT budget is enforced against the eager shards below.)
    expect(slimBytes).toBeLessThan(rawBytes * 0.2);
  });

  it("keeps the map's eager first-paint payload (manifest + core shard) under 600 KB", () => {
    // Cycle-5 sharding: #315 pushed the monolith to ~805 KB and forced the
    // first-paint budget to 900 KB. The map now paints from the CORE shard only
    // (inner-London priced index); the hollow Outer-London boroughs stream in
    // lazily. First paint is manifest + core, restored to the pre-#315 <600 KB.
    const manifestBytes = statSync(
      path.join(ROOT, "public", "data", "venues_slim.manifest.json"),
    ).size;
    const coreBytes = statSync(
      path.join(ROOT, "public", "data", "venues_slim.core.json"),
    ).size;
    expect(manifestBytes + coreBytes).toBeLessThan(600 * 1024);
  });

  it("keeps the all-in shard payload (core + every outer shard) under 1.2 MB", () => {
    const manifest = JSON.parse(
      readFileSync(
        path.join(ROOT, "public", "data", "venues_slim.manifest.json"),
        "utf8",
      ),
    ) as { shards: { url: string }[] };
    let total = statSync(
      path.join(ROOT, "public", "data", "venues_slim.manifest.json"),
    ).size;
    for (const shard of manifest.shards) {
      total += statSync(
        path.join(ROOT, "public", "data", shard.url.replace(/^\/data\//, "")),
      ).size;
    }
    expect(total).toBeLessThan(1200 * 1024);
  });
});
