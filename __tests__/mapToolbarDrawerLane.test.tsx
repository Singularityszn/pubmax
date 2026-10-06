// @vitest-environment jsdom
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import MapToolbar from "@/components/map/MapToolbar";
import { applyDrinkLane } from "@/lib/drinkLanes";
import type { DrinkCategory } from "@/lib/drinks";
import { FOCUS_TRAP_EXEMPT_ATTRIBUTE } from "@/lib/useFocusTrap";
import { initialFilters, type Filters } from "@/lib/venues";

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

  it("closes when a pub drawer hands the map straight to the planner", () => {
    render({ detailOpen: true });
    act(() => drinkButton().click());
    expect(trayOpen()).toBe(true);

    render({ detailOpen: false, planningOpen: true });
    expect(trayOpen()).toBe(false);
  });

  it("closes when the planner hands the map straight to a pub drawer", () => {
    render({ planningOpen: true });
    act(() => drinkButton().click());
    expect(trayOpen()).toBe(true);

    render({ planningOpen: false, detailOpen: true });
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

// QA journeys F24. The tray offers each drink once, as the lane picker's text
// tabs, and still reaches what the chosen drink adds.
function StatefulToolbar() {
  const [filters, setFilters] = useState<Filters>(initialFilters);
  return createElement(
    MapToolbar,
    props({
      filters,
      onFiltersChange: setFilters,
      drinkCategory: filters.drinkCategory,
      onDrinkLaneChange: (lane: DrinkCategory) =>
        setFilters((current) => applyDrinkLane(current, lane)),
    }),
  );
}

function laneTab(label: string): HTMLButtonElement {
  const tab = [
    ...host.querySelectorAll<HTMLButtonElement>(".drinkLanePickerOption"),
  ].find((button) => button.textContent === label);
  if (!tab) throw new Error(`no ${label} tab`);
  return tab;
}

const pintRefinements = () => host.querySelector(".drinkSubtypeChips") !== null;
const topShelf = () =>
  [...host.querySelectorAll("button")].some((button) =>
    button.textContent?.includes("Top shelf"),
  );

describe("the drink tray's choices", () => {
  beforeEach(() => {
    act(() => root.render(createElement(StatefulToolbar)));
  });

  it("offers the drinks once, as lane tabs, with nothing extra at rest", () => {
    act(() => drinkButton().click());
    expect(host.querySelector(".mapToolbar .drinkLanePicker")).not.toBeNull();
    expect(host.querySelector(".mapToolbar .drinkShapeChips")).toBeNull();
    expect(pintRefinements()).toBe(false);
    expect(topShelf()).toBe(false);
  });

  it("shows the pint refinements and Top shelf once Pints is pressed", () => {
    act(() => drinkButton().click());
    act(() => laneTab("Pints").click());
    expect(pintRefinements()).toBe(true);
    expect(topShelf()).toBe(true);
  });

  it("drops the pint refinements for another lane and when the tray reopens", () => {
    act(() => drinkButton().click());
    act(() => laneTab("Pints").click());
    act(() => laneTab("Wine").click());
    expect(pintRefinements()).toBe(false);

    act(() => laneTab("Pints").click());
    expect(pintRefinements()).toBe(true);
    act(() => drinkButton().click());
    act(() => drinkButton().click());
    expect(pintRefinements()).toBe(false);
  });

  it("still shows the soft-drinks link for the soft drinks lane", () => {
    act(() => drinkButton().click());
    act(() => laneTab("Soft drinks").click());
    expect(host.textContent).toContain("Soft drinks and water");
    expect(host.querySelector(".mapToolbar .drinkShapeChips")).toBeNull();
  });
});
