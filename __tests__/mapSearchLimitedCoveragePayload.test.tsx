// @vitest-environment jsdom

import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { listEnabledCities } from "@/lib/cities";
import type { MapSearchSuggestProps } from "@/components/map/MapSearchSuggest";

// Real rendered Search, index loader, slim decoder and result activation.
// Only the HTTP boundary returns synthetic public city packs. No live fetch.
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const FIXTURE_ID = "venue-mcr-fixture-crown";
const FIXTURE_NAME = "The Fixture Crown";
let MapSearchSuggest: typeof import("@/components/map/MapSearchSuggest").default;
let root: Root;
let container: HTMLDivElement;
let requests: string[];
let onSelectVenue: Mock<MapSearchSuggestProps["onSelectVenue"]>;

function SearchFixture({ mode, includeLocalResults }: {
  mode: "overlay" | "toolbar";
  includeLocalResults: boolean;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(mode === "toolbar");
  const props: MapSearchSuggestProps = {
    id: "payload-search",
    mode,
    cityId: "london",
    query,
    onQueryChange: setQuery,
    venues: [],
    localities: [],
    includeLocalResults,
    places: [],
    ukBasePubs: [],
    userLocation: null,
    mapCenter: [-2.5, 54.2],
    placeholder: "Search the map",
    onSelectVenue,
    onFlyToArea: () => {},
    onClose: () => setOpen(false),
  };
  return createElement("div", null,
    mode === "overlay" ? createElement("button", {
      "aria-expanded": open,
      onClick: () => setOpen(true),
    }, "Search the map") : null,
    open ? createElement(MapSearchSuggest, props) : null,
  );
}

beforeEach(async () => {
  // Give every observation a cold public cache. Do not replace our loaders.
  vi.resetModules();
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
  requests = [];
  onSelectVenue = vi.fn<MapSearchSuggestProps["onSelectVenue"]>();
  const allowedPaths = new Set(listEnabledCities().map((city) => city.slimVenuesPath));
  const { MAP_DATA_REVISION } = await import("@/lib/mapDataRevision");
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const pathname = new URL(String(input), "http://fixture.local").pathname;
    requests.push(pathname);
    if (!allowedPaths.has(pathname)) throw new Error(`Unexpected fixture request: ${pathname}`);
    return new Response(JSON.stringify({
      revision: MAP_DATA_REVISION,
      rows: pathname === "/data/cities/manchester/venues_slim.json" ? [{
        id: FIXTURE_ID, name: FIXTURE_NAME, borough: "Salford",
        lat: 53.483, lng: -2.245, cheapestPrice: null, kind: "pub",
      }] : [],
    }));
  }));
  MapSearchSuggest = (await import("@/components/map/MapSearchSuggest")).default;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function openSearch(mode: "overlay" | "toolbar", includeLocalResults = false) {
  await act(async () => root.render(createElement(SearchFixture, { mode, includeLocalResults })));
  if (mode === "overlay") {
    await act(async () => container.querySelector<HTMLButtonElement>("button")!.click());
  }
  const input = container.querySelector<HTMLInputElement>('[role="combobox"]')!;
  expect(input).not.toBeNull();
  expect(input.disabled).toBe(false);
  expect(input.readOnly).toBe(false);
  await act(async () => input.focus());
  expect(document.activeElement).toBe(input);
  return input;
}

async function typeQuery(input: HTMLInputElement, query: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, query);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  // Let the component's existing 80 ms debounce settle. No product timeout
  // or query threshold is changed for this public rendering observation.
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 100)); });
}

describe("limited-coverage Search payload", () => {
  it("opens and closes blank overlay Search without fetching city venue packs", async () => {
    const input = await openSearch("overlay");
    expect(requests).toEqual([]);
    await act(async () => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(container.querySelector('[role="combobox"]')).toBeNull();
    expect(container.querySelector("button")?.getAttribute("aria-expanded")).toBe("false");
    expect(requests).toEqual([]);
  });

  it("focuses blank toolbar Search without fetching city venue packs", async () => {
    await openSearch("toolbar");
    expect(requests).toEqual([]);
  });

  it.each(["overlay", "toolbar"] as const)("loads and activates a typed venue after blank %s focus", async (mode) => {
    const input = await openSearch(mode);
    expect(requests).toEqual([]);
    await typeQuery(input, FIXTURE_NAME);
    expect(requests).toContain("/data/venues_slim.json");
    expect(requests).toContain("/data/cities/manchester/venues_slim.json");
    const option = container.querySelector<HTMLElement>(`[role="option"][data-venue-id="${FIXTURE_ID}"]`);
    expect(option).not.toBeNull();
    expect(option?.textContent).toContain(FIXTURE_NAME);
    await act(async () => option!.click());
    expect(onSelectVenue).toHaveBeenCalledWith(FIXTURE_ID, "manchester");
  });

  it("preserves normal city blank-focus index warming", async () => {
    await openSearch("toolbar", true);
    expect(requests).toContain("/data/venues_slim.json");
    await typeQuery(container.querySelector<HTMLInputElement>('[role="combobox"]')!, FIXTURE_NAME);
    expect(container.querySelector(`[role="option"][data-venue-id="${FIXTURE_ID}"]`)?.textContent).toContain(FIXTURE_NAME);
  });
});
