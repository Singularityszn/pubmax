import { describe, it, expect } from "vitest";

import {
  hasCrawlArrivalParams,
  crawlStopsFromPubIds,
  filtersForCuratedCrawl,
  buildMapSeed,
  detailStatusFor,
  mapSelectionNotice,
  MAP_SELECTION_LOOKUP_FAILED_NOTE,
  UNKNOWN_MAP_SELECTION_NOTE,
  venueUpdateKey,
  normaliseTonightVenueLookup,
  type VenueDetailStatus,
} from "@/lib/pubMap";
import { curatedCrawls, type CuratedCrawl } from "@/lib/curatedCrawls";
import { initialFilters } from "@/components/map/ControlRail";
import {
  SAVED_ONLY_ARIA_LABEL,
  SAVED_ONLY_EMPTY_NOTE,
} from "@/lib/savedOnlyFilter";
import type { Filters, Venue } from "@/lib/venues";
import { readFileSync } from "node:fs";
import { join } from "node:path";

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
  expect(SAVED_ONLY_EMPTY_NOTE).toMatch(/Tap a pub and Save it/);
});

it("exposes Saved only on the phone Filters sheet with the shared field and empty note", () => {
  // The phone Filters sheet is JSX in PubMap (not a unit-rendered child), so
  // this pins the wiring: same aria label as ControlRail, same empty copy when
  // Saved only is on with nothing saved, and the toggle uses changeSavedOnly.
  const pubMap = readFileSync(join(process.cwd(), "components/PubMap.tsx"), "utf8");
  expect(pubMap).toContain("SAVED_ONLY_ARIA_LABEL");
  expect(pubMap).toContain("SAVED_ONLY_EMPTY_NOTE");
  expect(pubMap).toContain('className="toggles mobileMapSavedOnly"');
  expect(pubMap).toMatch(
    /aria-label=\{SAVED_ONLY_ARIA_LABEL\}[\s\S]*?checked=\{savedOnly\}[\s\S]*?changeSavedOnly/,
  );
  expect(pubMap).toMatch(
    /savedOnly && !hasSavedPub[\s\S]*?\{SAVED_ONLY_EMPTY_NOTE\}[\s\S]*?Show all pubs/,
  );
  const controlRail = readFileSync(
    join(process.cwd(), "components/map/ControlRail.tsx"),
    "utf8",
  );
  expect(controlRail).toContain("SAVED_ONLY_ARIA_LABEL");
  expect(controlRail).toMatch(
    /aria-label=\{SAVED_ONLY_ARIA_LABEL\}[\s\S]*?Saved only/,
  );
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

  it("plain arrival has no active crawl and an unmapped route", () => {
    const seed = buildMapSeed("");
    expect(seed.activeCrawl).toBeNull();
    expect(seed.routeMapped).toBe(false);
  });
});

describe("buildMapSeedWithCuratedCrawl", () => {
  it("curated arrival hydrates the named crawl and maps the route", async () => {
    const { buildMapSeedWithCuratedCrawl } = await import("@/lib/mapSeedCrawl");
    const seed = buildMapSeedWithCuratedCrawl("?crawl=victorian-soho");
    expect(seed.activeCrawl?.id).toBe("victorian-soho");
    expect(seed.crawlId).toBe("victorian-soho");
    expect(seed.routeMapped).toBe(true);
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

describe("mapSelectionNotice", () => {
  const base = {
    loaded: true,
    selectedVenueId: "the-dove-hammersmith",
    resolvable: false,
    ukBase: false,
    detailStatus: "missing" as VenueDetailStatus,
  };

  it("reports unknown only after a confirmed missing lookup", () => {
    expect(mapSelectionNotice(base)).toBe("unknown");
    expect(mapSelectionNotice({ ...base, detailStatus: "unavailable" })).toBe(
      "lookup-failed",
    );
  });

  it("stays silent while loading or before the index settles", () => {
    expect(mapSelectionNotice({ ...base, loaded: false })).toBeNull();
    expect(mapSelectionNotice({ ...base, detailStatus: "loading" })).toBeNull();
    expect(mapSelectionNotice({ ...base, detailStatus: "idle" })).toBeNull();
  });

  it("stays silent for a resolvable curated pin or a UK base id", () => {
    expect(mapSelectionNotice({ ...base, resolvable: true, selectedVenueId: "venue-xjf3n0" })).toBe(
      null,
    );
    expect(mapSelectionNotice({ ...base, ukBase: true, selectedVenueId: "venue-uk-1" })).toBe(
      null,
    );
  });

  it("stays silent with no selection", () => {
    expect(mapSelectionNotice({ ...base, selectedVenueId: "" })).toBeNull();
  });

  it("ships quiet empty-state voice with no em dash", () => {
    expect(UNKNOWN_MAP_SELECTION_NOTE).toBe("That pub is not one we know.");
    expect(MAP_SELECTION_LOOKUP_FAILED_NOTE).toBe("We could not check that pub right now.");
    expect(UNKNOWN_MAP_SELECTION_NOTE).not.toMatch(/\u2014/);
    expect(MAP_SELECTION_LOOKUP_FAILED_NOTE).not.toMatch(/\u2014/);
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
