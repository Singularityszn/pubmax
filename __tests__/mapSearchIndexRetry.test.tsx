// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { MapSearchIndex } from "@/lib/mapSearchIndex";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const CITIES = [{ id: "london", name: "London" }] as const;
// London's pack did not load, so only the venues the map held made the index.
const PARTIAL_INDEX = { cities: CITIES, venues: [] } satisfies MapSearchIndex;
const COMPLETE_INDEX = {
  cities: CITIES,
  venues: [
    {
      id: "venue-eltcmh",
      name: "The Blackfriar",
      area: "City of London",
      cityId: "london",
    },
  ],
} satisfies MapSearchIndex;

const loadMapSearchIndex = vi.fn<() => Promise<MapSearchIndex>>();

vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));
vi.mock("@/lib/mapSearchIndexLoader", () => ({
  isCompleteMapSearchIndex: (index: MapSearchIndex) => index === COMPLETE_INDEX,
  loadMapSearchIndex: () => loadMapSearchIndex(),
}));

import MapSearchSuggest from "@/components/map/MapSearchSuggest";

let container: HTMLDivElement;
let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container?.remove();
  loadMapSearchIndex.mockReset();
});

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("Map search index retry", () => {
  it.each(["SE1 9AA", "N1", "SE1"])("recovers an unsupported postcode as an area search, never a pub submission: %s", async (query) => {
    loadMapSearchIndex.mockResolvedValue(COMPLETE_INDEX);
    const onQueryChange = vi.fn();
    container = document.createElement("div");
    document.body.append(container);
    await act(async () => {
      root = createRoot(container);
      root.render(createElement(MapSearchSuggest, {
        id: "postcode-search", mode: "overlay", cityId: "london", query, onQueryChange,
        ukBasePubs: [{ id: "venue-uk-n1", name: "Yield N1", kind: "pub", address: "N1 2NA", lat: 51.5, lng: -0.1, curatedVenueId: "" }],
        venues: [], localities: [], userLocation: null, mapCenter: [-0.1276, 51.5072],
        placeholder: "Search the map", onSelectVenue: vi.fn(), onFlyToArea: vi.fn(),
      }));
    });
    await settle();
    expect(container.querySelector('[data-testid="map-search-add-pub"]')).toBeNull();
    const recovery = container.querySelector<HTMLButtonElement>(".mapSearchSuggestEmpty button");
    expect(recovery).not.toBeNull();
    act(() => recovery!.click());
    expect(onQueryChange).toHaveBeenCalledWith("");
  });
  it("asks again on the next focus after an index missing a city pack", async () => {
    loadMapSearchIndex
      .mockResolvedValueOnce(PARTIAL_INDEX)
      .mockResolvedValueOnce(COMPLETE_INDEX);
    container = document.createElement("div");
    document.body.append(container);

    await act(async () => {
      root = createRoot(container);
      root.render(
        createElement(MapSearchSuggest, {
          id: "map-search",
          mode: "overlay",
          cityId: "london",
          query: "Blackfriar",
          onQueryChange: vi.fn(),
          venues: [],
          localities: [],
          userLocation: null,
          mapCenter: [-0.1276, 51.5072],
          placeholder: "Search the map",
          onSelectVenue: vi.fn(),
          onFlyToArea: vi.fn(),
        }),
      );
    });
    await settle();
    expect(loadMapSearchIndex).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[data-venue-id="venue-eltcmh"]')).toBeNull();

    const input = container.querySelector<HTMLInputElement>('[role="combobox"]');
    act(() => input!.blur());
    act(() => input!.focus());
    await settle();

    expect(loadMapSearchIndex).toHaveBeenCalledTimes(2);
    expect(
      container.querySelector('[role="group"][aria-label="Venues"] [data-venue-id="venue-eltcmh"]'),
    ).not.toBeNull();

    act(() => input!.blur());
    act(() => input!.focus());
    await settle();
    expect(loadMapSearchIndex).toHaveBeenCalledTimes(2);
  });
});

it.each(["quiet pub with a fire near soho", "A missing pub"])('offers Pal for a search miss: %s', async (query) => {
  loadMapSearchIndex.mockResolvedValue(COMPLETE_INDEX);
  container = document.createElement("div");
  document.body.append(container);
  await act(async () => {
    root = createRoot(container);
    root.render(createElement(MapSearchSuggest, {
      id: "map-search", mode: "overlay", cityId: "london", query, onQueryChange: vi.fn(),
      venues: [], localities: [], userLocation: null, mapCenter: [-0.1276, 51.5072],
      placeholder: "Search the map", onSelectVenue: vi.fn(), onFlyToArea: vi.fn(),
    }));
  });
  await settle();
  const link = [...container.querySelectorAll("a")].find((item) => item.textContent?.includes("Ask Pub Pal"));
  expect(link).toBeDefined();
  const target = new URL(link!.href);
  expect(target.pathname).toBe("/pal/chat");
  expect(target.searchParams.get("draft")).toBe(query);
});
