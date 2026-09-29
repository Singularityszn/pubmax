// @vitest-environment jsdom

import { act, createElement, useLayoutEffect, useMemo } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useCrawlUrlSync } from "@/components/map/useCrawlUrl";
import { EMPTY_MAP_SURFACE_STATE, useMapSurfaceNavigation } from "@/components/map/pubmap/useMapSurfaceNavigation";
import type { CrawlUrlState } from "@/lib/crawlUrl";
import { stampMapSurfaceHistory } from "@/lib/mapSurfaceHistory";
import { initialFilters, type Filters } from "@/lib/venues";

function mapState(
  query: string,
  drinkCategory: Filters["drinkCategory"],
  selectedVenueId: string,
): CrawlUrlState {
  const filters: Filters = {
    ...initialFilters,
    query,
    drinkCategory,
    requireCocktails: drinkCategory === "cocktail",
  };
  return {
    mode: "suggest",
    filters,
    builtIds: [],
    selectedVenueId,
  };
}

function Harness({
  query,
  pending,
  drinkCategory = "",
  selectedVenueId = "",
  holdCleanUrl = false,
}: {
  query: string;
  pending: boolean;
  drinkCategory?: Filters["drinkCategory"];
  selectedVenueId?: string;
  holdCleanUrl?: boolean;
}) {
  const state = useMemo(
    () => mapState(query, drinkCategory, selectedVenueId),
    [query, drinkCategory, selectedVenueId],
  );
  useCrawlUrlSync(state, holdCleanUrl, pending);
  return null;
}

let openHistorySurface: ReturnType<typeof useMapSurfaceNavigation>["open"];
let closeHistorySurfaces: ReturnType<typeof useMapSurfaceNavigation>["home"];

function HistoryHarness({
  query,
  drinkCategory = "",
  selectedVenueId = "",
  holdCleanUrl = false,
  maxPrice = initialFilters.maxPrice,
  zone = initialFilters.zone,
}: {
  query: string;
  drinkCategory?: Filters["drinkCategory"];
  selectedVenueId?: string;
  holdCleanUrl?: boolean;
  maxPrice?: number;
  zone?: Filters["zone"];
}) {
  const state = useMemo(() => {
    const current = mapState(query, drinkCategory, selectedVenueId);
    return { ...current, filters: { ...current.filters, maxPrice, zone } };
  }, [query, drinkCategory, selectedVenueId, maxPrice, zone]);
  const onSurfaceClose = useCrawlUrlSync(state, holdCleanUrl);
  const trail = useMapSurfaceNavigation({
    arrivalSearch: window.location.search,
    surfaceId: "none",
    surfaceTitle: "",
    surfaceState: EMPTY_MAP_SURFACE_STATE,
    selectionHint: "",
    onRestore: () => {},
    onHome: () => {},
    onSurfaceClose,
  });
  useLayoutEffect(() => {
    openHistorySurface = trail.open;
    closeHistorySurfaces = trail.home;
  }, [trail.open, trail.home]);
  return null;
}

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  vi.useFakeTimers();
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.history.replaceState({}, "", "/map?crawl=victorian-soho");
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

describe("curated crawl URL hydration hold", () => {
  it("keeps category price intent while the chosen drink and venue sync", async () => {
    window.history.replaceState({}, "", "/map?drink=wine&contribute=price");
    await act(async () => {
      root.render(createElement(Harness, {
        query: "",
        pending: false,
        drinkCategory: "wine",
        selectedVenueId: "venue-16pnwmm",
      }));
    });
    act(() => vi.advanceTimersByTime(300));
    expect(window.location.search).toContain("contribute=price");
    expect(window.location.search).toContain("sel=venue-16pnwmm");
  });

  it("keeps crawl identity when map state changes before hydration", async () => {
    await act(async () => {
      root.render(createElement(Harness, { query: "Camden", pending: true }));
    });
    await act(async () => {
      root.render(createElement(Harness, { query: "Brixton", pending: true }));
    });
    act(() => vi.advanceTimersByTime(300));

    expect(window.location.search).toContain("crawl=victorian-soho");
    expect(window.location.search).toContain("q=Brixton");
  });

  it("removes crawl identity after hydration ends without a match", async () => {
    await act(async () => {
      root.render(createElement(Harness, { query: "Camden", pending: true }));
    });
    await act(async () => {
      root.render(createElement(Harness, { query: "Brixton", pending: false }));
    });
    act(() => vi.advanceTimersByTime(300));

    expect(window.location.search).not.toContain("crawl=");
    expect(window.location.search).toContain("q=Brixton");
  });

  it("removes an unmatched crawl identity even without a state edit", async () => {
    await act(async () => {
      root.render(createElement(Harness, { query: "", pending: true }));
    });
    await act(async () => {
      root.render(createElement(Harness, { query: "", pending: false }));
    });
    act(() => vi.advanceTimersByTime(300));

    expect(window.location.search).toBe("");
  });
});

describe("crawl URL after Map history traversal", () => {
  it.each(["wine", "cocktail"])("keeps %s across reopened sheets, Forward and Home", async (drinkCategory) => {
    window.history.replaceState({ root: true }, "", "/map/manchester");
    await act(async () => {
      root.render(createElement(HistoryHarness, { query: "" }));
    });
    act(() => openHistorySurface({ id: "drink", title: "Drink", state: EMPTY_MAP_SURFACE_STATE }));
    act(() => openHistorySurface({ id: "filters", title: "Filters", state: EMPTY_MAP_SURFACE_STATE }));
    act(() => openHistorySurface({ id: "drink", title: "Drink", state: EMPTY_MAP_SURFACE_STATE }));
    await act(async () => {
      root.render(createElement(HistoryHarness, { query: "", drinkCategory }));
    });
    act(() => vi.advanceTimersByTime(300));

    vi.useRealTimers();
    const back = new Promise<void>((resolve) =>
      window.addEventListener("popstate", () => resolve(), { once: true }),
    );
    await act(async () => {
      window.history.back();
      await back;
    });
    expect(new URLSearchParams(window.location.search).get("drink")).toBe(drinkCategory);

    await act(async () => {
      root.render(createElement(HistoryHarness, { query: "Changed", drinkCategory }));
    });
    const forward = new Promise<void>((resolve) =>
      window.addEventListener("popstate", () => resolve(), { once: true }),
    );
    await act(async () => {
      window.history.forward();
      await forward;
    });
    expect(window.location.pathname).toBe("/map/manchester");
    expect(new URLSearchParams(window.location.search).get("drink")).toBe(drinkCategory);
    expect(new URLSearchParams(window.location.search).get("q")).toBe("Changed");

    const home = new Promise<void>((resolve) =>
      window.addEventListener("popstate", () => resolve(), { once: true }),
    );
    await act(async () => {
      closeHistorySurfaces();
      await home;
    });
    expect(new URLSearchParams(window.location.search).get("drink")).toBe(drinkCategory);
    expect(new URLSearchParams(window.location.search).get("q")).toBe("Changed");
  });

  it.each([
    ["/map/manchester", "back"],
    ["/map/bristol", "home"],
  ] as const)("keeps changed city Map filters when %s closes with %s", async (path, close) => {
    window.history.replaceState({ root: true }, "", `${path}?q=Centre`);
    await act(async () => {
      root.render(createElement(HistoryHarness, { query: "Centre" }));
    });
    act(() => openHistorySurface({ id: "drink", title: "Drink", state: EMPTY_MAP_SURFACE_STATE }));
    await act(async () => {
      root.render(createElement(HistoryHarness, {
        query: "Centre", drinkCategory: "wine", maxPrice: 6, zone: "3",
      }));
    });
    act(() => vi.advanceTimersByTime(300));
    expect(window.location.pathname).toBe(path);
    expect(new URLSearchParams(window.location.search).get("drink")).toBe("wine");

    vi.useRealTimers();
    const landed = new Promise<void>((resolve) =>
      window.addEventListener("popstate", () => resolve(), { once: true }),
    );
    if (close === "home") act(() => closeHistorySurfaces());
    else window.history.back();
    await landed;

    expect(window.location.pathname).toBe(path);
    const landedSearch = new URLSearchParams(window.location.search);
    expect(landedSearch.get("q")).toBe("Centre");
    expect(landedSearch.get("max")).toBe("6");
    expect(landedSearch.get("drink")).toBe("wine");
    expect(landedSearch.get("zone")).toBe("3");
    expect(window.history.state.root).toBe(true);
  });

  it("leaves an earlier root entry's deliberate drink choice intact", async () => {
    window.history.replaceState(stampMapSurfaceHistory({ root: true }, [], ""), "", "/map?drink=cocktail&q=Soho");
    window.history.pushState(stampMapSurfaceHistory({ root: true }, [], ""), "", "/map?drink=wine&q=Soho");
    await act(async () => {
      root.render(createElement(HistoryHarness, { query: "Soho", drinkCategory: "wine" }));
    });

    vi.useRealTimers();
    const landed = new Promise<void>((resolve) =>
      window.addEventListener("popstate", () => resolve(), { once: true }),
    );
    window.history.back();
    await landed;

    expect(window.location.search).toBe("?drink=cocktail&q=Soho");

    const forward = new Promise<void>((resolve) =>
      window.addEventListener("popstate", () => resolve(), { once: true }),
    );
    await act(async () => {
      window.history.forward();
      await forward;
    });
    expect(window.location.search).toBe("?drink=wine&q=Soho");
  });

  it("keeps a changed drink lens shareable when Back closes its sheet", async () => {
    window.history.replaceState({ root: true }, "", "/map");
    await act(async () => {
      root.render(createElement(HistoryHarness, { query: "" }));
    });
    act(() => openHistorySurface({ id: "drink", title: "Drink", state: EMPTY_MAP_SURFACE_STATE }));
    await act(async () => {
      root.render(createElement(HistoryHarness, { query: "", drinkCategory: "wine" }));
    });
    act(() => vi.advanceTimersByTime(300));
    expect(window.location.search).toBe("?drink=wine");

    vi.useRealTimers();
    const landed = new Promise<void>((resolve) =>
      window.addEventListener("popstate", () => resolve(), { once: true }),
    );
    window.history.back();
    await landed;

    expect(window.location.search).toBe("?drink=wine");
    expect(window.history.state.root).toBe(true);
  });

  it("carries Wine, max price and zone across a sheet close without losing place context", async () => {
    window.history.replaceState({ root: true }, "", "/map?city=bristol&q=Soho");
    await act(async () => {
      root.render(createElement(HistoryHarness, { query: "Soho" }));
    });
    act(() => openHistorySurface({ id: "filters", title: "Filters", state: EMPTY_MAP_SURFACE_STATE }));
    await act(async () => {
      root.render(createElement(HistoryHarness, {
        query: "Soho", drinkCategory: "wine", maxPrice: 6, zone: "3",
      }));
    });
    act(() => vi.advanceTimersByTime(300));
    expect(window.location.search).toContain("city=bristol");

    vi.useRealTimers();
    const landed = new Promise<void>((resolve) =>
      window.addEventListener("popstate", () => resolve(), { once: true }),
    );
    window.history.back();
    await landed;

    expect(window.location.search).toBe("?city=bristol&q=Soho&max=6&drink=wine&zone=3");
  });

  it("keeps category and filters when Home unwinds multiple sheets", async () => {
    window.history.replaceState({ root: true }, "", "/map?q=Soho");
    await act(async () => {
      root.render(createElement(HistoryHarness, { query: "Soho" }));
    });
    act(() => openHistorySurface({ id: "drink", title: "Drink", state: EMPTY_MAP_SURFACE_STATE }));
    act(() => openHistorySurface({ id: "filters", title: "Filters", state: EMPTY_MAP_SURFACE_STATE }));
    await act(async () => {
      root.render(createElement(HistoryHarness, {
        query: "Soho", drinkCategory: "wine", maxPrice: 6, zone: "3",
      }));
    });

    vi.useRealTimers();
    const landed = new Promise<void>((resolve) =>
      window.addEventListener("popstate", () => resolve(), { once: true }),
    );
    act(() => closeHistorySurfaces());
    await landed;

    expect(window.location.search).toBe("?q=Soho&max=6&drink=wine&zone=3");
  });

  it("updates the drink lens without putting a closed venue back in the URL", async () => {
    window.history.replaceState({ root: true }, "", "/map?q=Soho");
    await act(async () => {
      root.render(createElement(HistoryHarness, {
        query: "Soho", drinkCategory: "cocktail",
      }));
    });
    act(() => openHistorySurface({
      id: "venue", title: "Venue", state: { ...EMPTY_MAP_SURFACE_STATE, venueId: "v1" },
    }));
    await act(async () => {
      root.render(createElement(HistoryHarness, {
        query: "Soho",
        drinkCategory: "cocktail",
        selectedVenueId: "v1",
      }));
    });
    act(() => vi.advanceTimersByTime(300));

    vi.useRealTimers();
    const landed = new Promise<void>((resolve) =>
      window.addEventListener("popstate", () => resolve(), { once: true }),
    );
    window.history.back();
    await landed;

    expect(window.location.search).toBe("?q=Soho&cocktails=1&drink=cocktail");
    expect(window.history.state.root).toBe(true);
  });

  it("does not let a pending venue URL write restore selection after immediate Back", async () => {
    window.history.replaceState({ root: true }, "", "/map");
    await act(async () => {
      root.render(createElement(HistoryHarness, { query: "" }));
    });
    act(() => openHistorySurface({
      id: "venue", title: "Venue", state: { ...EMPTY_MAP_SURFACE_STATE, venueId: "v1" },
    }));
    vi.useRealTimers();
    await act(async () => {
      root.render(createElement(HistoryHarness, {
        query: "", drinkCategory: "wine", selectedVenueId: "v1",
      }));
    });
    const landed = new Promise<void>((resolve) =>
      window.addEventListener("popstate", () => resolve(), { once: true }),
    );
    await act(async () => {
      window.history.back();
      await landed;
    });
    await new Promise((resolve) => setTimeout(resolve, 350));

    expect(window.location.search).toBe("?drink=wine");
  });

  it("keeps a clean arrival clean until the reader changes the saved lens", async () => {
    window.history.replaceState({ root: true }, "", "/map");
    await act(async () => {
      root.render(createElement(HistoryHarness, {
        query: "", drinkCategory: "wine", holdCleanUrl: true,
      }));
    });
    act(() => openHistorySurface({ id: "drink", title: "Drink", state: EMPTY_MAP_SURFACE_STATE }));

    vi.useRealTimers();
    const landed = new Promise<void>((resolve) =>
      window.addEventListener("popstate", () => resolve(), { once: true }),
    );
    window.history.back();
    await landed;

    expect(window.location.pathname + window.location.search).toBe("/map");
  });
});
