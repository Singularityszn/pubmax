// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

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
      venueKind: "bar",
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
  isCompleteMapSearchIndex: () => true,
  loadMapSearchIndex: vi.fn(() => Promise.resolve(SEARCH_INDEX)),
}));

import MapSearchSuggest from "@/components/map/MapSearchSuggest";
import { loadMapSearchIndex } from "@/lib/mapSearchIndexLoader";

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
  it.each([
    { query: "The Blackfriar", indexedName: "The Blackfriar", drinkCategory: "", expected: "indexed" },
    { query: "The Blackfriar", indexedName: "The Blackfriar", drinkCategory: "wine", expected: "indexed" },
    { query: "The Blackfriar", indexedName: "The Blackfriar Inn", drinkCategory: "", expected: "indexed" },
    { query: "The Blackfriar", indexedName: "The Blackfriar Inn", drinkCategory: "wine", expected: "loaded" },
  ])("ranks loaded and indexed matches together: $indexedName / $drinkCategory", async ({ query, indexedName, drinkCategory, expected }) => {
    const index = {
      cities: SEARCH_INDEX.cities,
      venues: [{ id: "indexed", name: indexedName, cityId: "london", area: "City of London", venueKind: "pub", pintPrice: 4.7 }],
    } as MapSearchIndex;
    vi.mocked(loadMapSearchIndex).mockResolvedValueOnce(index);
    const onSelectVenue = vi.fn();
    container = document.createElement("div");
    document.body.append(container);
    await act(async () => {
      root = createRoot(container);
      root.render(createElement(MapSearchSuggest, {
        id: "map-search", mode: "overlay", cityId: "london", query, drinkCategory,
        onQueryChange: vi.fn(), venues: [{ ...londonVenue(), id: "loaded", name: "The Blackfriar Kitchen", kind: "restaurant" }],
        localities: [], userLocation: null, mapCenter: [-0.1276, 51.5072],
        placeholder: "Search the map", onSelectVenue, onFlyToArea: vi.fn(),
      }));
      await Promise.resolve();
      await Promise.resolve();
    });
    const options = [...container.querySelectorAll<HTMLElement>('[role="group"][aria-label="Venues"] [data-venue-id]')];
    expect(options.map((option) => option.dataset.venueId)).toEqual(expected === "indexed" ? ["indexed", "loaded"] : ["loaded", "indexed"]);
    const input = container.querySelector<HTMLInputElement>('[role="combobox"]')!;
    act(() => input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
    expect(input.getAttribute("aria-activedescendant")).toBe(options[0]!.id);
    act(() => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(onSelectVenue).toHaveBeenCalledWith(...(expected === "indexed" ? ["indexed", "london"] : ["loaded"]));
  });

  it.each([
    { drinkCategory: "", expected: ["george-iv", "indexed-george", "george-dragon"] },
    { drinkCategory: "beer", expected: ["george-iv", "indexed-george", "george-dragon"] },
    { drinkCategory: "wine", expected: ["george-iv", "george-dragon", "indexed-george"] },
    { drinkCategory: "cider", expected: ["george-iv", "george-dragon", "indexed-george"] },
    { drinkCategory: "spirits", expected: ["george-iv", "george-dragon", "indexed-george"] },
  ])("preserves loaded $drinkCategory order before and after the index arrives", async ({ drinkCategory, expected }) => {
    let resolveIndex!: (index: MapSearchIndex) => void;
    vi.mocked(loadMapSearchIndex).mockReturnValueOnce(new Promise((resolve) => {
      resolveIndex = resolve;
    }));
    const onSelectVenue = vi.fn();
    container = document.createElement("div");
    document.body.append(container);
    await act(async () => {
      root = createRoot(container);
      root.render(createElement(MapSearchSuggest, {
        id: "map-search", mode: "overlay", cityId: "london", query: "geor", drinkCategory,
        onQueryChange: vi.fn(),
        venues: [
          { ...londonVenue(), id: "george-iv", name: "The George IV", latitude: 51.5147, longitude: -0.12 },
          { ...londonVenue(), id: "george-dragon", name: "George and Dragon, Fitzrovia", latitude: 51.52, longitude: -0.14, cheapestPrice: null },
        ],
        localities: [], userLocation: null, mapCenter: [-0.12, 51.5147],
        placeholder: "Search the map", onSelectVenue, onFlyToArea: vi.fn(),
      }));
    });
    const venueOptions = () => [...container.querySelectorAll<HTMLElement>(
      '[role="group"][aria-label="Venues"] [data-venue-id]',
    )];
    expect(venueOptions().map((option) => option.dataset.venueId)).toEqual(["george-iv", "george-dragon"]);

    await act(async () => {
      resolveIndex({
        cities: SEARCH_INDEX.cities,
        venues: [{ id: "indexed-george", name: "George Street Arms", cityId: "london", area: "Westminster", venueKind: "pub", pintPrice: 4.7 }],
      });
    });
    const options = venueOptions();
    expect(options.map((option) => option.dataset.venueId)).toEqual(expected);

    const input = container.querySelector<HTMLInputElement>('[role="combobox"]')!;
    for (const option of options) {
      act(() => input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
      expect(input.getAttribute("aria-activedescendant")).toBe(option.id);
      act(() => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    }
    expect(onSelectVenue.mock.calls).toEqual(expected.map((id) =>
      id === "indexed-george" ? [id, "london"] : [id],
    ));
  });

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

  it("lists a pub of this city the map has not loaded in Venues, not across city maps", async () => {
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
          // The opening viewport's shards: the City of London is not among them.
          venues: [],
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

    const venueIds = [...container.querySelectorAll<HTMLElement>(
      '[role="group"][aria-label="Venues"] [data-venue-id]',
    )].map((row) => row.dataset.venueId);
    expect(venueIds).toEqual(["venue-london-blackfriar"]);
    const localKind = container.querySelector<HTMLElement>(
      '[data-venue-id="venue-london-blackfriar"] .mapSearchSuggestBorough',
    );
    expect(localKind?.textContent).toBe("Pub");
    const crossCityKind = container.querySelector<HTMLElement>(
      '[data-venue-id="venue-mcr-black-friar"] .mapSearchSuggestBorough',
    );
    expect(crossCityKind?.textContent).toBe("Bar");
    const crossCityIds = [...container.querySelectorAll<HTMLElement>(
      '[role="group"][aria-label="Venues across city maps"] [data-venue-id]',
    )].map((row) => row.dataset.venueId);
    expect(crossCityIds).toEqual(["venue-mcr-black-friar"]);

    const input = container.querySelector<HTMLInputElement>('[role="combobox"]');
    act(() => {
      input!.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      );
    });
    const londonOption = container.querySelector<HTMLElement>(
      '[role="group"][aria-label="Venues"] [data-venue-id="venue-london-blackfriar"]',
    );
    expect(input!.getAttribute("aria-activedescendant")).toBe(londonOption!.id);
    act(() => {
      input!.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });
    expect(onSelectVenue).toHaveBeenCalledWith("venue-london-blackfriar", "london");
  });
});
