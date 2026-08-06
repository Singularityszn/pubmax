import { describe, it, expect } from "vitest";

import {
  hasCrawlArrivalParams,
  crawlStopsFromPubIds,
  filtersForCuratedCrawl,
  buildMapSeed,
  detailStatusFor,
  isUnknownMapSelection,
  UNKNOWN_MAP_SELECTION_NOTE,
  venueUpdateKey,
  normaliseTonightVenueLookup,
  type VenueDetailStatus,
} from "@/lib/pubMap";
import { curatedCrawls, type CuratedCrawl } from "@/lib/curatedCrawls";
import {
  initialFilters,
  SAVED_ONLY_ARIA_LABEL,
} from "@/components/map/ControlRail";
import type { Filters, Venue } from "@/lib/venues";

// Reference curated crawl from the default (london) city set — buildMapSeed
// resolves ?crawl= against curatedCrawlByIdForCity for DEFAULT_CITY_ID.
const soho = curatedCrawls.find((c) => c.id === "victorian-soho") as CuratedCrawl;

function makeVenue(overrides: Partial<Venue> = {}): Venue {
  return {
    id: "v1",
    name: "The Test Arms",
    prices: [],
    ...overrides,
  } as Venue;
}

it("describes Saved only as a venue-wide map filter", () => {
  expect(SAVED_ONLY_ARIA_LABEL).toBe("Show only venues you have saved");
});

describe("hasCrawlArrivalParams", () => {
  it("detects crawl-shaping deep-link params", () => {
    expect(hasCrawlArrivalParams("?crawl=victorian-soho")).toBe(true);
    expect(hasCrawlArrivalParams("?sel=v1")).toBe(true);
    expect(hasCrawlArrivalParams("?drink=stout")).toBe(true);
    expect(hasCrawlArrivalParams("?band=fleet")).toBe(true);
    expect(hasCrawlArrivalParams("?log=1")).toBe(true);
  });

  it("returns false for a clean arrival", () => {
    expect(hasCrawlArrivalParams("")).toBe(false);
    expect(hasCrawlArrivalParams("?utm_source=x")).toBe(false);
  });
});

describe("crawlStopsFromPubIds", () => {
  it("drops blanks and caps at three", () => {
    expect(crawlStopsFromPubIds(["a", "", "b", "c", "d"])).toEqual(["a", "b", "c"]);
    expect(crawlStopsFromPubIds([])).toEqual([]);
  });
});

describe("filtersForCuratedCrawl", () => {
  it("folds crawlStyle and leaves non-alcoholic untouched for a non-mocktail crawl", () => {
    const base: Filters = { ...initialFilters, requireNonAlcoholic: false };
    const crawl = { ...soho, crawlStyle: "heritage", altStyle: undefined } as CuratedCrawl;
    const next = filtersForCuratedCrawl(base, crawl);
    expect(next.crawlStyle).toBe("heritage");
    expect(next.requireNonAlcoholic).toBe(false);
  });

  it("forces non-alcoholic on for a mocktail crawl", () => {
    const base: Filters = { ...initialFilters, requireNonAlcoholic: false };
    const crawl = { ...soho, altStyle: "mocktail" } as CuratedCrawl;
    expect(filtersForCuratedCrawl(base, crawl).requireNonAlcoholic).toBe(true);
  });
});

describe("buildMapSeed", () => {
  it("drink-shape arrival lands clean with no active crawl", () => {
    const seed = buildMapSeed("?drink=stout");
    expect(seed.activeCrawl).toBeNull();
    expect(seed.routeMapped).toBe(false);
  });

  it("curated arrival hydrates the named crawl and maps the route", () => {
    const seed = buildMapSeed("?crawl=victorian-soho");
    expect(seed.activeCrawl?.id).toBe("victorian-soho");
    expect(seed.crawlId).toBe("victorian-soho");
    expect(seed.routeMapped).toBe(true);
  });

  it("plain arrival has no active crawl and an unmapped route", () => {
    const seed = buildMapSeed("");
    expect(seed.activeCrawl).toBeNull();
    expect(seed.routeMapped).toBe(false);
  });
});

describe("detailStatusFor", () => {
  const empty = new Map<string, Venue>();
  const status = new Map<string, VenueDetailStatus>();

  it("is idle with no selection", () => {
    expect(detailStatusFor("", empty, status)).toBe("idle");
  });

  it("is ready when detail is present", () => {
    const detail = new Map<string, Venue>([["v1", makeVenue()]]);
    expect(detailStatusFor("v1", detail, status)).toBe("ready");
  });

  it("falls back to the tracked status, defaulting to loading", () => {
    const tracked = new Map<string, VenueDetailStatus>([["v1", "unavailable"]]);
    expect(detailStatusFor("v1", empty, tracked)).toBe("unavailable");
    expect(detailStatusFor("v2", empty, status)).toBe("loading");
  });
});

describe("isUnknownMapSelection", () => {
  const base = {
    loaded: true,
    selectedVenueId: "the-dove-hammersmith",
    resolvable: false,
    ukBase: false,
    detailStatus: "unavailable" as VenueDetailStatus,
  };

  it("is true only after the index settles and detail warm reports unavailable", () => {
    expect(isUnknownMapSelection(base)).toBe(true);
  });

  it("stays false while still loading or before the index settles", () => {
    expect(isUnknownMapSelection({ ...base, loaded: false })).toBe(false);
    expect(isUnknownMapSelection({ ...base, detailStatus: "loading" })).toBe(false);
    expect(isUnknownMapSelection({ ...base, detailStatus: "idle" })).toBe(false);
  });

  it("stays false for a resolvable curated pin or a UK base id", () => {
    expect(isUnknownMapSelection({ ...base, resolvable: true, selectedVenueId: "venue-xjf3n0" })).toBe(
      false,
    );
    expect(isUnknownMapSelection({ ...base, ukBase: true, selectedVenueId: "venue-uk-1" })).toBe(
      false,
    );
  });

  it("stays false with no selection", () => {
    expect(isUnknownMapSelection({ ...base, selectedVenueId: "" })).toBe(false);
  });

  it("ships quiet empty-state voice with no em dash", () => {
    expect(UNKNOWN_MAP_SELECTION_NOTE).toBe("That pub is not one we know.");
    expect(UNKNOWN_MAP_SELECTION_NOTE).not.toMatch(/\u2014/);
  });
});

describe("venueUpdateKey", () => {
  it("uses the first price grouping key when priced", () => {
    const venue = makeVenue({
      id: "v9",
      prices: [
        { pub_name: "The Test Arms", address: "1 Dean St", latitude: 51.5, longitude: -0.13 },
      ] as unknown as Venue["prices"],
    });
    // grouping key is derived from the first price, not the raw id.
    expect(venueUpdateKey(venue)).not.toBe("v9");
    expect(typeof venueUpdateKey(venue)).toBe("string");
  });

  it("falls back to the venue id when unpriced", () => {
    expect(venueUpdateKey(makeVenue({ id: "v9", prices: [] }))).toBe("v9");
  });
});

describe("normaliseTonightVenueLookup", () => {
  it("lowercases, strips apostrophes, expands &, and collapses punctuation", () => {
    expect(normaliseTonightVenueLookup("O’Neill’s & Co.")).toBe("oneills and co");
    expect(normaliseTonightVenueLookup("  The  Crown  ")).toBe("the crown");
  });
});
