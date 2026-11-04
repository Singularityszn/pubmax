// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import MapToolbar from "@/components/map/MapToolbar";
import { initialFilters } from "@/lib/venues";
import { computeZonePintIndex } from "@/lib/zones";

// ONE DESKTOP TOOLBAR (PlanAstra item 9, launch UX micro-fix 7). At 768 and
// 1440 the map once opened with 20 to 24 controls. The toolbar's share of the
// first load is search, Filters (the venue kinds, Show me and the zone behind
// one disclosure), the drink lane, Plan and the area switcher. The map's own
// zooms and Layers bring the whole arrival set to eight, so the toolbar may
// never offer more than five on its own, and the whole set never more than
// eight. THE COUNT ONLY COMES DOWN.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const noop = () => undefined;

/** The map controls outside the toolbar on first load: zoom in, zoom out, Layers. */
const MAP_CONTROLS_OUTSIDE_TOOLBAR = 3;
const FIRST_LOAD_CEILING = 8;

const FOCUSABLE = [
  "button",
  "input",
  "select",
  "textarea",
  "a[href]",
  '[role="combobox"]',
  '[tabindex]:not([tabindex="-1"])',
].join(",");

function props(overrides: Record<string, unknown> = {}) {
  return {
    query: "",
    onQueryChange: noop,
    searchContent: createElement("input", { "aria-label": "Search pubs" }),
    favoritePint: null,
    onFavoritePintChange: noop,
    drinkFiltersActive: false,
    drinkCategory: "",
    drinkBrand: "",
    onDrinkBrandChange: noop,
    onDrinkLaneChange: noop,
    drinkLaneStatus: "ready",
    spoonsValueOn: false,
    spoonsValueLens: { status: "idle" },
    onSpoonsValueChange: noop,
    personaId: null,
    onPersonaSelect: noop,
    personaTonightCategory: null,
    planningOpen: false,
    detailOpen: false,
    desktopLaneActive: false,
    onTogglePlanning: noop,
    filters: initialFilters,
    onFiltersChange: noop,
    searchSettled: true,
    filteredVenueCount: 10,
    searchableVenueCount: 10,
    zoneIndex: computeZonePintIndex([]),
    experienceLens: "all",
    experienceSummary: "",
    onExperienceLensChange: noop,
    venueKindVisibility: { pub: true, bar: true, food: true, restaurant: true },
    onVenueKindVisibilityChange: noop,
    onUseMyLocation: noop,
    onOpenChooseArea: noop,
    ...overrides,
  } as never;
}

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  // A desktop viewport: the phone query does not match.
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

function firstLoadControls(): HTMLElement[] {
  const toolbar = host.querySelector<HTMLElement>(".mapToolbar");
  if (!toolbar) throw new Error("no toolbar");
  return Array.from(toolbar.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (node) => !node.closest("[hidden], [inert], [aria-hidden='true']") && !(node as HTMLButtonElement).disabled,
  );
}

describe("the desktop map toolbar on first load", () => {
  it("offers search, Filters, the drink lane, Plan and the area, and nothing else", async () => {
    await act(async () => root.render(createElement(MapToolbar, props())));
    // The viewport answer lands a microtask later; let it.
    await act(async () => Promise.resolve());

    const controls = firstLoadControls();
    const names = controls.map(
      (node) => node.getAttribute("aria-label") ?? node.textContent?.trim() ?? node.tagName,
    );

    expect(controls.length, `toolbar controls: ${names.join(" | ")}`).toBeLessThanOrEqual(
      FIRST_LOAD_CEILING - MAP_CONTROLS_OUTSIDE_TOOLBAR,
    );
    expect(host.querySelector(".mapVenueKindFilterBtn")).not.toBeNull();
    expect(host.querySelector(".mapToolbarDrinkLaneBtn")).not.toBeNull();
    expect(host.querySelector(".planBtn")).not.toBeNull();
    // The kind chips wait behind Filters; nothing of theirs is on the bar.
    expect(host.querySelector(".mapVenueKindFilterPanel")).toBeNull();
    // The drink panel is closed at rest.
    expect(host.querySelector(".mapToolbarDrinkChoices")).toBeNull();
  });
});
