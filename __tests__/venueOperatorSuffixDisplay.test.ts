// A reader never sees "- JD Wetherspoon" as a pub's name, and nothing that
// reads the dataset's own name breaks because of it. lib/venueDisplay.ts owns
// the display rule; lib/venueOperatorSuffix.mjs is the one pattern the
// canonicalizer and the display share.
import { describe, expect, it } from "vitest";

import { buildMapSearchIndex, searchMapSearchIndex } from "@/lib/mapSearchIndex";
import { slimVenueToPin } from "@/lib/slimPins";
import { displayVenueName, venueSourceNameField } from "@/lib/venueDisplay";
import { venueMenuLookupKeys } from "@/lib/venueMenu";
import { OPERATOR_SUFFIX_RE } from "@/lib/venueOperatorSuffix.mjs";
import { matchVenuePermalinkSlug } from "@/lib/venuePermalinkSlug";
import {
  filterVenues,
  groupVenuePrices,
  initialFilters,
  stableVenueIdFromKey,
  venueGroupingKey,
  type VenuePrice,
} from "@/lib/venues";
import type { SlimVenue } from "@/lib/venuesSlim";
import {
  canonicalizeDataset,
  normalizeVenueIdentityName,
} from "@/scripts/lib/venueCanonicalization.mjs";
import { defined } from "@/__tests__/helpers/defined";

function makeRow(overrides: Partial<VenuePrice> = {}): VenuePrice {
  return {
    app_price_id: "",
    pub_name: "The Test Arms",
    pint_name: "Lager",
    price_gbp: 6,
    price_text: "",
    address: "1 Test Street",
    latitude: 51.5,
    longitude: -0.1,
    boroughs_visible: "",
    boroughs_raw_embedded_non_anomaly: "",
    boroughs_raw_embedded_site_anomaly: "",
    primary_borough: "Camden",
    rank_visible_borough: "",
    estimated_average_price_text: "",
    pub_url: "",
    constructed_pub_url: "",
    borough_urls: "",
    phone_number: "",
    email: "",
    website: "",
    booking_link: "",
    image_url: "",
    description: "",
    comment: "",
    food: "",
    cocktails: "",
    beer_garden: "",
    live_sports: "",
    live_music: "",
    pub_quiz: "",
    darts: "",
    pool: "",
    happy_hour: "",
    karaoke: "",
    cool: "",
    source_datasets: "",
    source_row_count: 1,
    has_visible_borough_row: false,
    has_raw_embedded_map_row: false,
    has_individual_pub_page_row: false,
    is_clean_canonical_app_row: true,
    data_quality_notes: "",
    ...overrides,
  };
}

// The only record of this pub carries the suffix: no clean sibling to prefer.
const MOON_ON_THE_HILL = makeRow({
  pub_name: "The Moon on the Hill - JD Wetherspoon",
  pint_name: "Bud Light",
  price_gbp: 2.49,
  address: "373-375 Station Rd, Harrow HA1 2AW, UK",
  latitude: 51.5794,
  longitude: -0.3342,
  primary_borough: "Harrow",
});

describe("displayVenueName", () => {
  it("drops every operator suffix the canonicalizer knows", () => {
    expect(displayVenueName("The Moon on the Hill - JD Wetherspoon")).toBe("The Moon on the Hill");
    expect(displayVenueName("The Pennsylvanian (JD Wetherspoons)")).toBe("The Pennsylvanian");
    expect(displayVenueName("The Furze Wren (Wetherspoons)")).toBe("The Furze Wren");
    expect(displayVenueName("J.J. Moon's - JD Wetherspoon")).toBe("J.J. Moon's");
    expect(displayVenueName("Wetherspoons (Victoria Station) - JD Wetherspoon")).toBe(
      "Wetherspoons (Victoria Station)",
    );
    expect(displayVenueName("The Old Bell – Greene King")).toBe("The Old Bell");
    expect(displayVenueName("The Rose - Young's")).toBe("The Rose");
  });

  it("leaves a name with no operator suffix exactly as filed", () => {
    expect(displayVenueName("The Rochester Castle")).toBe("The Rochester Castle");
    expect(displayVenueName("George (Southwark)")).toBe("George (Southwark)");
    expect(displayVenueName("Young's Brewery Tap")).toBe("Young's Brewery Tap");
    // A name that is nothing but the operator is not emptied.
    expect(displayVenueName("Wetherspoons")).toBe("Wetherspoons");
  });

  it("keeps the dataset's name beside the display name only when they differ", () => {
    expect(venueSourceNameField("The Moon on the Hill - JD Wetherspoon")).toEqual({
      sourceName: "The Moon on the Hill - JD Wetherspoon",
    });
    expect(venueSourceNameField("The Rochester Castle")).toEqual({});
  });

  it("shares one pattern with the duplicate-identity canonicalizer", () => {
    // Same rule, two readers: what display drops, identity folds away.
    expect(OPERATOR_SUFFIX_RE.test("The Moon on the Hill - JD Wetherspoon")).toBe(true);
    expect(normalizeVenueIdentityName(displayVenueName("The Moon on the Hill - JD Wetherspoon"))).toBe(
      normalizeVenueIdentityName("The Moon on the Hill - JD Wetherspoon"),
    );
  });
});

describe("a suffixed pub with no clean sibling", () => {
  it("displays clean while its id is still derived from the dataset's name", () => {
    const venue = defined(groupVenuePrices([MOON_ON_THE_HILL])[0]);
    expect(venue.name).toBe("The Moon on the Hill");
    expect(venue.sourceName).toBe("The Moon on the Hill - JD Wetherspoon");
    // The id is the one every stored drop, plan and save already holds.
    expect(venue.id).toBe(stableVenueIdFromKey(venueGroupingKey(MOON_ON_THE_HILL)));
    expect(venue.id).not.toBe(
      stableVenueIdFromKey(venueGroupingKey({ ...MOON_ON_THE_HILL, pub_name: "The Moon on the Hill" })),
    );
    // The price row keeps its raw name for chain detection and keyed updates.
    expect(defined(venue.prices[0]).pub_name).toBe("The Moon on the Hill - JD Wetherspoon");
  });

  it("survives canonicalization untouched, so the row keeps its identity", () => {
    const { rows, aliases } = canonicalizeDataset([MOON_ON_THE_HILL]);
    expect(aliases).toEqual({});
    expect(defined(rows[0]).pub_name).toBe("The Moon on the Hill - JD Wetherspoon");
  });

  it("keys a drink update by the name the dataset files", () => {
    const venue = defined(groupVenuePrices([MOON_ON_THE_HILL])[0]);
    const withoutPrices = { ...venue, prices: [] };
    expect(venueMenuLookupKeys(withoutPrices)).toContain(
      "the moon on the hill - jd wetherspoon|373-375 station rd, harrow ha1 2aw, uk|51.57940|-0.33420",
    );
  });
});

describe("a suffixed pub whose clean sibling exists", () => {
  it("still merges onto the clean sibling", () => {
    const seed = makeRow({
      pub_name: "The Rochester Castle",
      price_gbp: 1.99,
      address: "143-145 Stoke Newington High Street, , Stoke Newington, England",
      latitude: 51.561,
      longitude: -0.073976,
      primary_borough: "Hackney",
    });
    const spoons = makeRow({
      pub_name: "The Rochester Castle - JD Wetherspoon",
      price_gbp: 2.43,
      address: "143-145 Stoke Newington High St, London N16 0NY, UK",
      latitude: 51.5609,
      longitude: -0.074042,
      primary_borough: "Hackney",
    });
    const seedId = stableVenueIdFromKey(venueGroupingKey(seed));
    const spoonsId = stableVenueIdFromKey(venueGroupingKey(spoons));
    const { rows, aliases } = canonicalizeDataset([seed, spoons]);
    expect(aliases).toEqual({ [spoonsId]: seedId });
    const venues = groupVenuePrices(rows);
    expect(venues).toHaveLength(1);
    expect(defined(venues[0]).id).toBe(seedId);
    expect(defined(venues[0]).name).toBe("The Rochester Castle");
    expect(defined(venues[0]).sourceName).toBeUndefined();
  });
});

describe("a slim pin", () => {
  const slim: SlimVenue = {
    id: "venue-1pf9vt5",
    name: "The Furze Wren - JD Wetherspoon",
    lat: 51.4568,
    lng: 0.146512,
    cheapestPrice: 2.59,
    borough: "Bexley",
    filterHints: {
      searchText:
        "the furze wren - jd wetherspoon broadway square, bexleyheath da6 7dy, uk bexley",
      amenities: { food: true, cocktails: false, beerGarden: false, liveSports: false, nonAlcoholic: false },
      curation: { nearWater: false, hasStory: false },
      canonical: true,
    },
  };

  it("keeps its id, shows the clean name and still reads its address", () => {
    const pin = slimVenueToPin(slim);
    expect(pin.id).toBe("venue-1pf9vt5");
    expect(pin.name).toBe("The Furze Wren");
    expect(pin.sourceName).toBe("The Furze Wren - JD Wetherspoon");
    expect(pin.address).toBe("broadway square, bexleyheath da6 7dy, uk");
  });

  it("reads the same address when its slim row was normalised already", () => {
    const pin = slimVenueToPin({ ...slim, name: "The Furze Wren", sourceName: slim.name });
    expect(pin.name).toBe("The Furze Wren");
    expect(pin.address).toBe("broadway square, bexleyheath da6 7dy, uk");
  });

  it("still lands a documented accessibility seed filed under the suffixed name", () => {
    const pin = slimVenueToPin({
      id: "venue-icewharf",
      name: "The Ice Wharf - JD Wetherspoon",
      lat: 51.541,
      lng: -0.148,
      cheapestPrice: 2.5,
      borough: "Camden",
    });
    expect(pin.name).toBe("The Ice Wharf");
    expect(pin.accessibility?.stepFree).toBe(true);
  });
});

describe("searching for the operator", () => {
  // Before: every one of these searches matched because the name carried the
  // suffix. After: the name is clean and `sourceName` keeps them matching.
  it("the map filter still finds a Wetherspoon by 'wetherspoon'", () => {
    const venues = groupVenuePrices([MOON_ON_THE_HILL, makeRow({ pub_name: "The Grapes" })]);
    const hits = filterVenues(venues, { ...initialFilters, query: "wetherspoon", maxPrice: 100 });
    expect(hits.map((venue) => venue.name)).toEqual(["The Moon on the Hill"]);
  });

  it("the map search index still finds a Wetherspoon by 'wetherspoon'", () => {
    const index = buildMapSearchIndex(
      [{ id: "london", displayName: "London" }],
      [
        {
          cityId: "london",
          venues: [
            {
              id: "venue-moon",
              name: "The Moon on the Hill",
              sourceName: "The Moon on the Hill - JD Wetherspoon",
              area: "Harrow",
            },
            { id: "venue-grapes", name: "The Grapes", area: "Limehouse" },
          ],
        },
      ],
    );
    const hits = searchMapSearchIndex(index, "wetherspoon");
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ kind: "venue", id: "venue-moon", name: "The Moon on the Hill" });
  });

  it("an old suffixed permalink and the clean one both resolve", () => {
    const candidates = [
      {
        id: "venue-moon",
        name: "The Moon on the Hill",
        sourceName: "The Moon on the Hill - JD Wetherspoon",
        searchText: "the moon on the hill - jd wetherspoon 373-375 station rd, harrow ha1 2aw",
      },
    ];
    expect(matchVenuePermalinkSlug("the-moon-on-the-hill-jd-wetherspoon", candidates)).toBe("venue-moon");
    expect(matchVenuePermalinkSlug("the-moon-on-the-hill-ha1", candidates)).toBe("venue-moon");
  });
});
