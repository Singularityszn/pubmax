import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { initialFilters } from "@/components/map/ControlRail";
import MapToolbar from "@/components/map/MapToolbar";
import { getCity } from "@/lib/cities";

// "Map area: X" is the one sentence on this control that is literally a claim
// about the area, so once a reader picks one it may not keep naming the city.

function toolbarProps(overrides: Record<string, unknown> = {}) {
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
    personaId: null,
    onPersonaSelect: vi.fn(),
    personaTonightCategory: null,
    planningOpen: false,
    detailOpen: false,
    desktopLaneActive: false,
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
    ...overrides,
  };
}

function renderToolbar(overrides: Record<string, unknown> = {}) {
  return renderToStaticMarkup(createElement(MapToolbar, toolbarProps(overrides)));
}

describe("the desktop map area chip", () => {
  it("names the city when no area has been chosen", () => {
    const html = renderToolbar();
    const london = getCity("london").displayName;
    expect(html).toContain(`Map area: ${london}. Change city`);
  });

  it("names the remembered area once one is chosen", () => {
    const html = renderToolbar({ cityLabel: "Camden" });
    expect(html).toContain("Map area: Camden. Change city");
    expect(html).toContain(">Camden<");
    // And it stops making the claim it no longer supports.
    expect(html).not.toContain("Map area: London. Change city");
  });

  it("carries a Near me answer's own label the same way", () => {
    const html = renderToolbar({ cityLabel: "Near me" });
    expect(html).toContain("Map area: Near me. Change city");
  });
});
