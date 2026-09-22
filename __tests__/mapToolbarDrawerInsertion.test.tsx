// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { initialFilters } from "@/components/map/ControlRail";
import MapToolbar from "@/components/map/MapToolbar";
import { SPOONS_VALUE_LENS_OFF } from "@/lib/spoonsValue";

function toolbarProps() {
  return {
    query: "",
    onQueryChange: vi.fn(),
    searchContent: null,
    favoritePint: null,
    onFavoritePintChange: vi.fn(),
    drinkFiltersActive: false,
    drinkCategory: "",
    drinkBrand: "",
    onDrinkBrandChange: vi.fn(),
    onDrinkLaneChange: vi.fn(),
    drinkLaneStatus: "ready" as const,
    spoonsValueOn: false,
    spoonsValueLens: SPOONS_VALUE_LENS_OFF,
    onSpoonsValueChange: vi.fn(),
    personaId: null,
    onPersonaSelect: vi.fn(),
    personaTonightCategory: null,
    planningOpen: true,
    detailOpen: false,
    desktopLaneActive: true,
    onTogglePlanning: vi.fn(),
    filters: initialFilters,
    onFiltersChange: vi.fn(),
    searchSettled: true,
    filteredVenueCount: 12,
    searchableVenueCount: 12,
    zoneIndex: {
      rows: [],
      ranked: [],
      dearest: null,
      cheapest: null,
      taxGbp: null,
    },
    cityId: "london" as const,
    experienceLens: "all" as const,
    experienceSummary: "Everything",
    onExperienceLensChange: vi.fn(),
  };
}

function plannerDrawer(open = true): HTMLElement {
  const drawer = document.createElement("aside");
  drawer.className = `mapDrawer left${open ? " open" : ""}`;
  vi.spyOn(drawer, "getBoundingClientRect").mockReturnValue({
    x: 0,
    y: 0,
    width: 376,
    height: 900,
    top: 0,
    right: 376,
    bottom: 900,
    left: 0,
    toJSON: () => ({}),
  });
  return drawer;
}

describe("MapToolbar late drawer lane", () => {
  let shell: HTMLDivElement;
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    vi.stubGlobal("ResizeObserver", class {
      observe() {}
      unobserve() {}
      disconnect() {}
    });
    shell = document.createElement("div");
    shell.className = "appShell planning-open";
    host = document.createElement("div");
    shell.appendChild(host);
    document.body.appendChild(shell);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    shell.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function expectPlannerOffsetAfter(change: () => void) {
    await act(async () => {
      change();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.querySelector<HTMLElement>(".mapToolbar")?.style.transform).toBe(
      "translateX(calc(-50% + 188px))",
    );
  }

  it("jumps before its first owned frame when the drawer mounts later", async () => {
    await act(async () => root.render(createElement(MapToolbar, toolbarProps())));
    expect(host.querySelector<HTMLElement>(".mapToolbar")?.style.transform).toBe("");

    const drawer = plannerDrawer();
    await expectPlannerOffsetAfter(() => shell.insertBefore(drawer, host));
  });

  it("also sees an existing drawer become open", async () => {
    const drawer = plannerDrawer(false);
    shell.insertBefore(drawer, host);
    await act(async () => root.render(createElement(MapToolbar, toolbarProps())));
    expect(host.querySelector<HTMLElement>(".mapToolbar")?.style.transform).toBe("");

    await expectPlannerOffsetAfter(() => drawer.classList.add("open"));
  });
});
