// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import MapToolbar from "@/components/map/MapToolbar";
import { FOCUS_TRAP_EXEMPT_ATTRIBUTE } from "@/lib/useFocusTrap";
import { initialFilters } from "@/lib/venues";

// QA journeys F04. The drink tray closes when a pub drawer or the planner
// opens, and the bar stays a live surface beside the desktop drawer.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const noop = () => undefined;

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
    desktopLaneActive: true,
    onTogglePlanning: noop,
    filters: initialFilters,
    onFiltersChange: noop,
    searchSettled: true,
    filteredVenueCount: 10,
    searchableVenueCount: 10,
    zoneIndex: {},
    experienceLens: "all",
    experienceSummary: "",
    onExperienceLensChange: noop,
    ...overrides,
  } as never;
}

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
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

function render(overrides: Record<string, unknown> = {}) {
  act(() => root.render(createElement(MapToolbar, props(overrides))));
}

function drinkButton(): HTMLButtonElement {
  const button = host.querySelector<HTMLButtonElement>(".mapToolbarDrinkLaneBtn");
  if (!button) throw new Error("no drink button");
  return button;
}

const trayOpen = () => host.querySelector(".drinkLanePicker") !== null;

describe("the drink tray and a surface that opens", () => {
  it("closes when a pub drawer opens, and can be reopened beside it", () => {
    render();
    act(() => drinkButton().click());
    expect(trayOpen()).toBe(true);

    render({ detailOpen: true });
    expect(trayOpen()).toBe(false);

    act(() => drinkButton().click());
    expect(trayOpen()).toBe(true);
    // Still open on the next render: only the opening edge closes it.
    render({ detailOpen: true });
    expect(trayOpen()).toBe(true);
  });

  it("closes when the planner opens", () => {
    render();
    act(() => drinkButton().click());
    render({ planningOpen: true });
    expect(trayOpen()).toBe(false);
  });

  it("closes when a landmark story opens", () => {
    render();
    act(() => drinkButton().click());
    render({ storyOpen: true });
    expect(trayOpen()).toBe(false);
  });

  it("stays open while a surface that was already open stays open", () => {
    render({ detailOpen: true });
    act(() => drinkButton().click());
    render({ detailOpen: true, filteredVenueCount: 11 });
    expect(trayOpen()).toBe(true);
  });
});

describe("the bar beside the desktop drawer", () => {
  it("is an exempt surface of the drawer's focus trap on the desktop lane", () => {
    render({ detailOpen: true });
    expect(
      host.querySelector(".mapToolbar")?.hasAttribute(FOCUS_TRAP_EXEMPT_ATTRIBUTE),
    ).toBe(true);
  });

  it("is not exempt below the desktop lane, where the drawer has no free lane for it", () => {
    render({ detailOpen: true, desktopLaneActive: false });
    expect(
      host.querySelector(".mapToolbar")?.hasAttribute(FOCUS_TRAP_EXEMPT_ATTRIBUTE),
    ).toBe(false);
  });
});
