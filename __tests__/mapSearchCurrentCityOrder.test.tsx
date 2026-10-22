// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { lensPricesForVenues, type MapLensPrice } from "@/lib/mapExperienceLens";
import { activeLensPricesFor } from "@/lib/pubMap";
import { filterVenuesByKind } from "@/lib/venueKindFilters";
import type { MapSearchIndex } from "@/lib/mapSearchIndex";
import type { Venue } from "@/lib/venues";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const SEARCH_INDEX = {
  cities: [
    { id: "london", name: "London" },
    { id: "manchester", name: "Manchester" },
  ],
  venues: [
    {
      id: "venue-mcr-black-friar",
      name: "The Black Friar",
      area: "Salford",
      cityId: "manchester",
    },
    {
      id: "venue-london-blackfriar",
      name: "The Blackfriar",
      area: "City of London",
      cityId: "london",
    },
  ],
} satisfies MapSearchIndex;

vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));
vi.mock("@/lib/mapSearchIndexLoader", () => ({
  loadMapSearchIndex: vi.fn(() => Promise.resolve(SEARCH_INDEX)),
}));

import MapSearchSuggest from "@/components/map/MapSearchSuggest";

let container: HTMLDivElement;
let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container?.remove();
  vi.clearAllMocks();
});

function londonVenue(): Venue {
  return {
    id: "venue-london-blackfriar",
    name: "The Blackfriar",
    kind: "pub",
    latitude: 51.5116,
    longitude: -0.1042,
    primaryBorough: "City of London",
    cheapestPrice: 6.5,
    latestContributorPrice: null,
  } as Venue;
}

describe("Map search current-city priority", () => {
  it("selects the current Map venue before a cross-city name match", async () => {
    const onSelectVenue = vi.fn();
    container = document.createElement("div");
    document.body.append(container);

    await act(async () => {
      root = createRoot(container);
      root.render(
        createElement(MapSearchSuggest, {
          id: "map-search",
          mode: "overlay",
          cityId: "london",
          query: "The Blackfriar",
          onQueryChange: vi.fn(),
          venues: [londonVenue()],
          localities: [],
          userLocation: null,
          mapCenter: [-0.1276, 51.5072],
          placeholder: "Search the map",
          onSelectVenue,
          onFlyToArea: vi.fn(),
        }),
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    const groups = [...container.querySelectorAll<HTMLElement>('[role="group"]')]
      .map((group) => group.getAttribute("aria-label"));
    expect(groups.indexOf("Venues")).toBeLessThan(
      groups.indexOf("Venues across city maps"),
    );
    const crossCityIds = [...container.querySelectorAll<HTMLElement>(
      '[role="group"][aria-label="Venues across city maps"] [data-venue-id]',
    )].map((row) => row.dataset.venueId);
    expect(crossCityIds).toEqual(["venue-mcr-black-friar"]);

    const input = container.querySelector<HTMLInputElement>('[role="combobox"]');
    expect(input).not.toBeNull();
    act(() => {
      input!.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      );
    });

    const localOption = container.querySelector<HTMLElement>(
      '[role="group"][aria-label="Venues"] [data-venue-id="venue-london-blackfriar"]',
    );
    expect(localOption).not.toBeNull();
    expect(input!.getAttribute("aria-activedescendant")).toBe(localOption!.id);
    expect(localOption!.getAttribute("aria-selected")).toBe("true");

    act(() => {
      input!.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });

    expect(onSelectVenue).toHaveBeenCalledTimes(1);
    expect(onSelectVenue).toHaveBeenCalledWith("venue-london-blackfriar");
  });
});


describe("Map search selected-drink price", () => {
  it.each([
    ["loading", "Gin price not read yet"],
    ["degraded", "Gin price could not be read"],
    ["ready", "No gin price logged"],
  ] as const)("keeps a %s Gin read honest instead of falling back to the pint", async (lensStatus, label) => {
    const selectedLane = {
      lensPrices: new Map<string, MapLensPrice>(),
      lensCategoryLabel: "gin",
      lensStatus,
    };
    container = document.createElement("div");
    document.body.append(container);
    await act(async () => {
      root = createRoot(container);
      root.render(createElement(MapSearchSuggest, {
        id: "map-search-gin-unread",
        mode: "overlay",
        cityId: "london",
        query: "The Blackfriar",
        onQueryChange: vi.fn(),
        venues: [londonVenue()],
        localities: [],
        userLocation: null,
        mapCenter: [-0.1276, 51.5072],
        placeholder: "Search the map",
        onSelectVenue: vi.fn(),
        onFlyToArea: vi.fn(),
        ...selectedLane,
      }));
      await Promise.resolve();
      await Promise.resolve();
    });
    const row = container.querySelector<HTMLElement>(
      '[role="group"][aria-label="Venues"] [data-venue-id="venue-london-blackfriar"]',
    );
    expect(row).not.toBeNull();
    expect(row!.textContent).toContain(label);
    expect(row!.textContent).not.toContain("£6.50");
  });

  it("names the Gin quote and printed measure rather than the pub's pint figure", async () => {
    const onSelectVenue = vi.fn();
    const albion = {
      ...londonVenue(),
      id: "venue-1qge8u",
      name: "The Albion",
      primaryBorough: "Hammersmith and Fulham",
      cheapestPrice: 5.4,
    };
    const ginQuote: MapLensPrice = {
      venueId: albion.id,
      category: "gin",
      categoryLabel: "Gin",
      priceGbp: 4,
      source: "listed",
      servingSize: "25ml",
      drinkLabel: "GORDONS",
      observedAt: "2026-10-01T14:16:36.325Z",
      sourceUrl: "https://www.thealbionpub.com/uploads/drink.pdf?v=1772220206",
    };
    const selectedLane = {
      lensPrices: new Map([[albion.id, ginQuote]]),
      lensCategoryLabel: "gin",
      lensStatus: "ready" as const,
    };
    container = document.createElement("div");
    document.body.append(container);

    await act(async () => {
      root = createRoot(container);
      root.render(createElement(MapSearchSuggest, {
        id: "map-search-gin",
        mode: "overlay",
        cityId: "london",
        query: "Albion",
        onQueryChange: vi.fn(),
        venues: [albion],
        localities: [],
        userLocation: null,
        mapCenter: [-0.1276, 51.5072],
        placeholder: "Search the map",
        onSelectVenue,
        onFlyToArea: vi.fn(),
        ...selectedLane,
      }));
      await Promise.resolve();
      await Promise.resolve();
    });

    const row = container.querySelector<HTMLElement>(
      '[role="option"][data-venue-id="venue-1qge8u"]',
    );
    expect(row).not.toBeNull();
    expect(row!.textContent).toContain("Gin");
    expect(row!.textContent).toContain("£4.00");
    expect(row!.textContent).toContain("25ml");
    expect(row!.textContent).not.toContain("£5.40");

    act(() => row!.click());
    expect(onSelectVenue).toHaveBeenCalledWith("venue-1qge8u");
  });
});


describe("Map search experience price scope", () => {
  it.each(["food", "no-alcohol"] as const)("keeps a known %s price for a searchable venue hidden from the canvas", async (experienceLens) => {
    const knownVenue = experienceLens === "food" ? {
      ...londonVenue(), id: "known-menu", name: "Known Kitchen", kind: "restaurant" as const,
      cheapestPrice: 15, anchorLabel: "Large lamb doner",
      anchorObservedAt: "2026-10-01", anchorSourceUrl: "https://menu.example.org/doner",
    } : { ...londonVenue(), id: "known-soft-drink", name: "Known Arms" };
    const allSearchVenues = [knownVenue];
    const canvasVenues = filterVenuesByKind(allSearchVenues, {
      pub: false, bar: false, food: false, restaurant: false,
    });
    expect(canvasVenues).toHaveLength(0);
    const noAlcoholPrices = new Map<string, MapLensPrice>(experienceLens === "no-alcohol" ? [[knownVenue.id, {
      venueId: knownVenue.id, category: "soft-drink", categoryLabel: "Soft drinks",
      priceGbp: 2.5, source: "community", servingSize: "250ml",
    }]] : []);
    // Search matches the full venue collection even while Map kind filters hide it.
    const searchPrices = activeLensPricesFor(experienceLens, null,
      lensPricesForVenues(allSearchVenues, experienceLens, noAlcoholPrices));
    container = document.createElement("div");
    document.body.append(container);
    await act(async () => {
      root = createRoot(container);
      root.render(createElement(MapSearchSuggest, {
        id: "map-search-experience",
        mode: "overlay",
        cityId: "london",
        query: "Known",
        onQueryChange: vi.fn(),
        venues: allSearchVenues,
        localities: [],
        userLocation: null,
        mapCenter: [-0.1276, 51.5072],
        placeholder: "Search the map",
        onSelectVenue: vi.fn(),
        onFlyToArea: vi.fn(),
        lensPrices: searchPrices,
        lensCategoryLabel: experienceLens === "food" ? "food" : "alcohol-free or soft drink",
        lensStatus: "ready",
      }));
      await Promise.resolve();
      await Promise.resolve();
    });
    const row = container.querySelector<HTMLElement>(`[role="option"][data-venue-id="${knownVenue.id}"]`);
    expect(row).not.toBeNull();
    expect(row!.textContent).toContain(experienceLens === "food" ? "Large lamb doner" : "Soft drinks");
    expect(row!.textContent).toContain(experienceLens === "food" ? "£15.00" : "£2.50");
    expect(row!.textContent).not.toMatch(/No food price|No alcohol-free or soft drink price/);
  });
});
