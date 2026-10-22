// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import { useMapVenueCollections } from "@/components/map/useMapVenueCollections";
import { filterMapVenues } from "@/lib/filterMapVenues";
import { filtersForExperienceLens, type MapExperienceLens, type MapLensPrice } from "@/lib/mapExperienceLens";
import { typedSearchCameraMove } from "@/lib/mapSearchCamera";
import { defaultVenueKindVisibility } from "@/lib/venueKindFilters";
import { initialFilters, type Venue } from "@/lib/venues";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function pub(id: string, name: string, longitude: number, nonAlcoholic = false): Venue {
  return {
    id, name, address: "London", latitude: 51.51, longitude, primaryBorough: "Westminster", visibleBoroughs: [],
    prices: [], cheapestPrice: null, cheapestPint: "", averagePrice: null, hasStory: false,
    latestContributorPrice: null, latestContributorAt: null,
    amenities: {
      food: false, cocktails: false, beerGarden: false, liveSports: false, liveMusic: false,
      pubQuiz: false, darts: false, pool: false, happyHour: false, karaoke: false, nonAlcoholic,
    },
    website: "", bookingLink: "", imageUrl: "", description: "", dataQualityNotes: [], sourceDatasets: [], curation: {}, kind: "pub",
  };
}

const VENUES = [
  pub("king-one", "King One", -0.2),
  pub("king-two", "King Two", -0.19, true),
  pub("other", "Other Arms", -0.13),
];
const BY_ID = new Map(VENUES.map((venue) => [venue.id, venue]));
const NO_ALCOHOL_PRICES = new Map<string, MapLensPrice>();
const mounted: Array<ReturnType<typeof createRoot>> = [];

afterEach(() => {
  for (const root of mounted.splice(0)) act(() => root.unmount());
});

function collections({
  venues = VENUES,
  query = "King",
  pints = true,
  lens = "all",
  nearby = null,
  selectedVenueId = "",
  searchPickedVenueId = "",
}: {
  venues?: Venue[];
  query?: string;
  pints?: boolean;
  lens?: MapExperienceLens;
  nearby?: { venueIds: string[] } | null;
  selectedVenueId?: string;
  searchPickedVenueId?: string;
} = {}) {
  const filters = filtersForExperienceLens({ ...initialFilters, query }, lens);
  const filteredVenues = filterMapVenues(venues, filters, () => false);
  let current: ReturnType<typeof useMapVenueCollections> | undefined;
  function CollectionBoundary() {
    current = useMapVenueCollections({
      filteredVenues,
      pinVenues: filteredVenues,
      nearbyMapResultForView: nearby,
      experienceLens: lens,
      noAlcoholLensPrices: NO_ALCOHOL_PRICES,
      venueKindVisibility: { ...defaultVenueKindVisibility(), pub: pints },
      venueById: BY_ID,
      selectedVenueId,
      query,
      searchPickedVenueId,
    });
    return null;
  }
  const root = createRoot(document.createElement("div"));
  mounted.push(root);
  act(() => root.render(createElement(CollectionBoundary)));
  return current!;
}

describe("search recovery membership after desktop search loses focus without a pick", () => {
  it.each([1, 2])("offers no recovery for %i King matches while Pints is off", (count) => {
    const state = collections({ venues: VENUES.slice(0, count), pints: false });
    expect(state.canvasVenues).toEqual([]);
    expect(state.filteredPubVenues.map((venue) => venue.id)).toEqual([]);
    expect(state.filteredPubVenues).toHaveLength(0);
  });

  it("schedules no automatic single-pub move or multiple-pub fit for excluded kinds", () => {
    for (const count of [1, 2]) {
      const state = collections({ venues: VENUES.slice(0, count), pints: false });
      expect(typedSearchCameraMove({
        query: "King", matchCount: state.filteredPubVenues.length,
        searchFieldFocused: false, cameraOwnedByPick: false,
      })).toBe("none");
    }
  });

  it("counts only the drawable King pub under the no-alcohol experience filter", () => {
    const state = collections({ lens: "no-alcohol" });
    expect(state.canvasVenues.map((venue) => venue.id)).toEqual(["king-two"]);
    expect(state.filteredPubVenues.map((venue) => venue.id)).toEqual(["king-two"]);
    expect(state.filteredPubVenues).toHaveLength(1);
    expect(typedSearchCameraMove({
      query: "King", matchCount: state.filteredPubVenues.length,
      searchFieldFocused: false, cameraOwnedByPick: false,
    })).toBe("select-one");
  });

  it("offers no recovery when the experience filter excludes every match", () => {
    const state = collections({ venues: [VENUES[0]!], lens: "no-alcohol" });
    expect(state.canvasVenues).toEqual([]);
    expect(state.filteredPubVenues).toHaveLength(0);
  });

  it("keeps offscreen matches recoverable without broadening the query", () => {
    const state = collections();
    expect(state.filteredPubVenues.map((venue) => venue.id)).toEqual(["king-one", "king-two"]);
    expect(state.canvasVenues.map((venue) => venue.id)).toEqual(["king-one", "king-two"]);
    expect(state.canvasVenues.map((venue) => venue.longitude)).toEqual([-0.2, -0.19]);
    expect(typedSearchCameraMove({
      query: "King", matchCount: state.filteredPubVenues.length,
      searchFieldFocused: false, cameraOwnedByPick: false,
    })).toBe("fit-many");
  });

  it.each(["selectedVenueId", "searchPickedVenueId"] as const)("preserves the explicit %s drawing override", (field) => {
    const state = collections({ pints: false, [field]: "king-one" });
    expect(state.kindVisibleMapVenues).toEqual([]);
    expect(state.canvasVenues.map((venue) => venue.id)).toEqual(["king-one"]);
    expect(typedSearchCameraMove({
      query: "King", matchCount: state.filteredPubVenues.length,
      searchFieldFocused: false, cameraOwnedByPick: true,
    })).toBe("none");
  });

  it("keeps nearby drawing membership and pub coordinates intact", () => {
    const state = collections({ nearby: { venueIds: ["king-two"] } });
    expect(state.canvasVenues.map((venue) => [venue.id, venue.longitude, venue.latitude])).toEqual([
      ["king-two", -0.19, 51.51],
    ]);
  });

  it("does not retain a search pick after the query clears", () => {
    const state = collections({ query: "", pints: false, searchPickedVenueId: "king-one" });
    expect(state.canvasVenues).toEqual([]);
  });
});
