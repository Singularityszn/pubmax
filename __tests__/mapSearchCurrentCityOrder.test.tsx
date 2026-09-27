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
