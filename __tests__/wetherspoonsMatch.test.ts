import { describe, expect, it } from "vitest";

import { initialFilters } from "@/components/map/ControlRail";
import type { WetherspoonsPub } from "@/lib/wetherspoonsDirectory";
import {
  WETHERSPOONS_FILTER_EMPTY_TITLE,
  WETHERSPOONS_FILTER_IDENTITY_NOTE,
  matchWetherspoonsDirectoryPub,
  matchedWetherspoonsVenueIds,
  normalizeWetherspoonsMatchName,
} from "@/lib/wetherspoonsMatch";
import { filterVenues, type Filters, type Venue } from "@/lib/venues";

function pub(
  overrides: Partial<WetherspoonsPub> & Pick<WetherspoonsPub, "name" | "latitude" | "longitude">,
): WetherspoonsPub {
  return {
    wpId: 1,
    jdwPubId: "1",
    slug: "test",
    pageUrl: "https://www.jdwetherspoon.com/pubs/test/",
    menuUrl: null,
    phone: null,
    fullAddress: null,
    addressLine1: null,
    addressLine2: null,
    townCity: null,
    county: null,
    postcode: null,
    country: "England",
    bookATableLink: null,
    regularOpeningTimes: [],
    facilities: [],
    regions: [],
    statuses: [],
    menuPricesAvailableOnWeb: false,
    source: {
      label: "jdwetherspoon.com",
      url: "https://www.jdwetherspoon.com/",
      licence: "scraped",
    },
    observedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

function venue(overrides: Partial<Venue> & Pick<Venue, "id" | "name">): Venue {
  return {
    id: overrides.id,
    name: overrides.name,
    address: "Test Street",
    latitude: 51.54,
    longitude: -0.14,
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
    ...overrides,
  };
}

function filters(overrides: Partial<Filters> = {}): Filters {
  return { ...initialFilters, ...overrides };
}

describe("wetherspoonsMatch (isomorphic)", () => {
  it("normalises Ice Wharf style suffixes and bare Hamilton Hall names the same way", () => {
    expect(normalizeWetherspoonsMatchName("The Ice Wharf - JD Wetherspoon")).toBe("ice wharf");
    expect(normalizeWetherspoonsMatchName("The Ice Wharf")).toBe("ice wharf");
    expect(normalizeWetherspoonsMatchName("Hamilton Hall")).toBe("hamilton hall");
  });

  it("matches by exact normalised name inside 250 m and refuses a distant same-name hit", () => {
    const pubs = [
      pub({
        name: "The Ice Wharf",
        latitude: 51.5404,
        longitude: -0.145649,
      }),
    ];
    expect(
      matchWetherspoonsDirectoryPub(
        { name: "The Ice Wharf - JD Wetherspoon", lat: 51.5404, lng: -0.145649 },
        pubs,
      )?.name,
    ).toBe("The Ice Wharf");
    expect(
      matchWetherspoonsDirectoryPub(
        { name: "The Ice Wharf - JD Wetherspoon", lat: 51.5, lng: -0.1 },
        pubs,
      ),
    ).toBeNull();
  });

  it("returns only the venue ids that join the directory", () => {
    const pubs = [
      pub({
        name: "The Ice Wharf",
        latitude: 51.5404,
        longitude: -0.145649,
      }),
    ];
    const ids = matchedWetherspoonsVenueIds(
      [
        {
          id: "ice-wharf",
          name: "The Ice Wharf - JD Wetherspoon",
          lat: 51.5404,
          lng: -0.145649,
        },
        {
          id: "indie",
          name: "The Local Arms",
          lat: 51.54,
          lng: -0.14,
        },
      ],
      pubs,
    );
    expect([...ids]).toEqual(["ice-wharf"]);
  });
});

describe("wetherspoonsOnly map filter", () => {
  it("narrows curated venues to directory-matched ids without inventing prices", () => {
    const ice = venue({
      id: "ice-wharf",
      name: "The Ice Wharf - JD Wetherspoon",
      latitude: 51.5404,
      longitude: -0.145649,
      cheapestPrice: 4.2,
    });
    const indie = venue({
      id: "indie",
      name: "The Local Arms",
      cheapestPrice: 3.5,
    });
    const matched = new Set(["ice-wharf"]);
    const kept = filterVenues(
      [ice, indie],
      filters({ wetherspoonsOnly: true }),
      () => false,
      (id) => matched.has(id),
    );
    expect(kept.map((row) => row.id)).toEqual(["ice-wharf"]);
    expect(kept[0]?.cheapestPrice).toBe(4.2);
  });

  it("is a no-op when the flag is off", () => {
    const pubs = [venue({ id: "a", name: "A" }), venue({ id: "b", name: "B" })];
    expect(
      filterVenues(pubs, filters({ wetherspoonsOnly: false }), () => false, () => false),
    ).toHaveLength(2);
  });

  it("keeps an honest empty sentence that never claims Spoons prices", () => {
    expect(WETHERSPOONS_FILTER_EMPTY_TITLE).toBe("No matched Spoons in this view");
    expect(WETHERSPOONS_FILTER_IDENTITY_NOTE).toMatch(/who runs the pub/i);
    expect(WETHERSPOONS_FILTER_IDENTITY_NOTE).toMatch(/not what it charges/i);
    expect(WETHERSPOONS_FILTER_EMPTY_TITLE).not.toMatch(/£|price/i);
    expect(WETHERSPOONS_FILTER_IDENTITY_NOTE).not.toMatch(/£/);
    expect(`${WETHERSPOONS_FILTER_EMPTY_TITLE} ${WETHERSPOONS_FILTER_IDENTITY_NOTE}`).not.toContain(
      "—",
    );
  });
});
