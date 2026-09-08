// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SlimVenue } from "@/lib/venuesSlim";
import type { Venue } from "@/lib/venues";

const reads = vi.hoisted(() => ({ load: vi.fn(), snapshot: vi.fn(), write: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));
vi.mock("@/lib/venuesSlim", () => ({
  loadSlimVenuesForCityResult: reads.load,
}));
vi.mock("@/lib/surfaceDataCache", () => ({
  readSurfaceSnapshot: reads.snapshot,
  writeSurfaceSnapshot: reads.write,
}));

const arnos: SlimVenue = {
  id: "venue-xjf3n0", name: "Arnos Arms", lat: 51.6162, lng: -0.132117,
  cheapestPrice: 5.5, borough: "Enfield",
};
let container: HTMLDivElement;
let root: Root | undefined;

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  reads.snapshot.mockReturnValue(undefined);
  reads.load.mockImplementation(async (city: string) => ({
    status: "ready", rows: city === "london" ? [arnos] : [],
  }));
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  container.remove();
});

async function openSearch(mode: "overlay" | "toolbar" = "overlay") {
  const { default: MapSearchSuggest } = await import("@/components/map/MapSearchSuggest");
  root = createRoot(container);
  await act(async () => {
    root?.render(createElement(MapSearchSuggest, {
      id: "audit-search", mode, cityId: "london", query: "Arnos Arms", placeholder: "Search venues",
      venues: [{ id: "venue-core", name: "Central Pub", primaryBorough: "Westminster" } as Venue],
      localities: [], userLocation: null, mapCenter: [-0.12, 51.51],
      onQueryChange: vi.fn(), onSelectVenue: vi.fn(), onFlyToArea: vi.fn(),
    }));
  });
}

it("finds a venue outside the map's loaded cells", async () => {
  await openSearch();

  expect(container.querySelector('[data-venue-id="venue-xjf3n0"]')?.textContent).toContain("Arnos Arms");
  expect(reads.load).toHaveBeenCalledWith("london");
  expect(container.querySelector('[data-testid="map-search-no-results"]')).toBeNull();
});

it("keeps keyboard focus on retry after an incomplete search", async () => {
  reads.load.mockImplementation(async (city: string) => ({
    status: city === "london" ? "unavailable" : "ready", rows: [],
  }));
  await openSearch("toolbar");
  await act(async () => container.querySelector("input")?.focus());

  expect(container.textContent).toContain("Some venues could not load.");
  expect(container.querySelector('[data-testid="map-search-no-results"]')).toBeNull();
  expect(reads.write).not.toHaveBeenCalled();

  reads.load.mockImplementation(async (city: string) => ({
    status: "ready", rows: city === "london" ? [arnos] : [],
  }));
  const retry = [...container.querySelectorAll("button")].find((button) => button.textContent === "Try again");
  await act(async () => retry?.focus());
  expect(document.activeElement).toBe(retry);
  expect(retry?.isConnected).toBe(true);
  await act(async () => retry?.click());

  expect(container.querySelector('[data-venue-id="venue-xjf3n0"]')).not.toBeNull();
  expect(container.textContent).not.toContain("Some venues could not load.");
  expect(reads.write).toHaveBeenCalledOnce();
});

it("discards partial search snapshots from the previous cache version", async () => {
  const { listEnabledCities } = await import("@/lib/cities");
  reads.snapshot.mockImplementation((key: string) => key === "map-search-index:v1" ? {
    cities: listEnabledCities().map((city) => ({ id: city.id, name: city.displayName })), venues: [],
  } : undefined);
  const { loadMapSearchIndex } = await import("@/lib/mapSearchIndexLoader");

  const [first, second] = await Promise.all([loadMapSearchIndex(), loadMapSearchIndex()]);

  expect(first).toBe(second);
  expect(first.venues).toContainEqual({ id: arnos.id, name: arnos.name, area: arnos.borough, cityId: "london" });
  expect(reads.load).toHaveBeenCalledTimes(listEnabledCities().length);
});
