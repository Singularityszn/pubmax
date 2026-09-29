// @vitest-environment jsdom

import { act, createElement, useLayoutEffect, useMemo } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useCrawlUrlSync } from "@/components/map/useCrawlUrl";
import { EMPTY_MAP_SURFACE_STATE, useMapSurfaceNavigation } from "@/components/map/pubmap/useMapSurfaceNavigation";
import type { CrawlUrlState } from "@/lib/crawlUrl";
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
  it("leaves an earlier root entry's deliberate drink choice intact", async () => {
    window.history.replaceState({ root: true }, "", "/map?drink=cocktail&q=Soho");
    window.history.pushState({ root: true }, "", "/map?drink=wine&q=Soho");
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
