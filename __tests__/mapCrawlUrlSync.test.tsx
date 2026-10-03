// @vitest-environment jsdom

import { act, createElement, useLayoutEffect, useMemo } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CRAWL_URL_DEBOUNCE_MS, useCrawlUrlSync } from "@/components/map/useCrawlUrl";
import { EMPTY_MAP_SURFACE_STATE, useMapSurfaceNavigation } from "@/components/map/pubmap/useMapSurfaceNavigation";
import { seedCrawlState, type CrawlUrlState } from "@/lib/crawlUrl";
import { curatedCrawlHydrationFromSeed } from "@/lib/mapSeedCrawl";
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
  plan,
  pending = false,
  landmarkId = "",
}: {
  query: string;
  drinkCategory?: Filters["drinkCategory"];
  selectedVenueId?: string;
  holdCleanUrl?: boolean;
  maxPrice?: number;
  zone?: Filters["zone"];
  plan?: Pick<CrawlUrlState, "mode" | "builtIds" | "crawlId" | "routeDrinkIntent">;
  pending?: boolean;
  landmarkId?: string;
}) {
  const state = useMemo(() => {
    const current = mapState(query, drinkCategory, selectedVenueId);
    return { ...current, ...plan, landmarkId, filters: { ...current.filters, maxPrice, zone } };
  }, [query, drinkCategory, selectedVenueId, maxPrice, zone, plan, landmarkId]);
  const onSurfaceClose = useCrawlUrlSync(state, holdCleanUrl, pending);
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

async function traverseHistory(action: () => void) {
  const landed = new Promise<void>((resolve) =>
    window.addEventListener("popstate", () => resolve(), { once: true }),
  );
  await act(async () => {
    action();
    await vi.advanceTimersByTimeAsync(10);
    await landed;
  });
}

describe("crawl identity after Map history traversal", () => {
  it("keeps a clean Back checkpoint while a direct landmark story loads", async () => {
    window.history.replaceState({}, "", "/map?landmark=covent-garden");
    await act(async () => {
      root.render(createElement(HistoryHarness, { query: "", landmarkId: "covent-garden" }));
    });
    expect(window.history.state.pubmaxMapSurface.stack).toMatchObject([
      { id: "landmark", state: { landmarkId: "covent-garden" } },
    ]);
    expect(window.location.search).toBe("?landmark=covent-garden");

    act(() => vi.advanceTimersByTime(300));
    expect(window.location.search).toBe("?landmark=covent-garden");

    await traverseHistory(() => closeHistorySurfaces());
    expect(window.location.pathname + window.location.search).toBe("/map");
    expect(window.history.state.pubmaxMapSurface.stack).toEqual([]);
  });

  it.each(["back", "home", "forward"] as const)(
    "reloads edited stops after %s before the debounce",
    async (direction) => {
      const arrival = "?crawl=victorian-soho";
      const original = await curatedCrawlHydrationFromSeed(arrival, "london");
      expect(original).not.toBeNull();
      const originalIds = original!.crawl.venueIds;
      const replacement = await curatedCrawlHydrationFromSeed("?crawl=fleet-street-writers", "london");
      expect(replacement).not.toBeNull();
      const edits = [
        { builtIds: [...originalIds].reverse(), crawlId: "" },
        { builtIds: originalIds.slice(1), crawlId: "" },
        { builtIds: [...originalIds, "extra-pub"], crawlId: "" },
        { builtIds: [], crawlId: "" },
        { builtIds: replacement!.crawl.venueIds, crawlId: replacement!.crawl.id },
      ];
      for (const edit of edits) {
        window.history.replaceState({ root: true }, "", `/map${arrival}#route`);
        await act(async () => {
          root.unmount();
          root = createRoot(host);
          root.render(createElement(HistoryHarness, {
            query: "", plan: { mode: "build", builtIds: originalIds, crawlId: original!.crawl.id },
          }));
        });
        act(() => vi.advanceTimersByTime(300));
        act(() => openHistorySurface({ id: "planner", title: "Plan", state: EMPTY_MAP_SURFACE_STATE }));
        if (direction === "home") {
          act(() => openHistorySurface({ id: "filters", title: "Filters", state: EMPTY_MAP_SURFACE_STATE }));
        }
        if (direction === "forward") await traverseHistory(() => window.history.back());
        const historyLength = window.history.length;
        await act(async () => {
          root.render(createElement(HistoryHarness, {
            query: "", plan: { mode: "build", ...edit },
          }));
        });
        await traverseHistory(() => {
          if (direction === "home") closeHistorySurfaces();
          else if (direction === "forward") window.history.forward();
          else window.history.back();
        });

        const reloaded = seedCrawlState(window.location.search);
        const hydration = await curatedCrawlHydrationFromSeed(window.location.search, "london");
        expect(hydration?.crawl.venueIds ?? reloaded.builtIds).toEqual(edit.builtIds);
        expect(reloaded.crawlId).toBe(edit.crawlId);
        expect(reloaded.builtIds).toEqual(edit.builtIds);
        expect(window.history.length).toBe(historyLength);
        expect(window.history.state.root).toBe(true);
        expect(window.location.hash).toBe("#route");
      }
    },
  );

  it.each(["back", "home", "forward"] as const)(
    "preserves pending hydration across %s and drops an unmatched identity afterwards",
    async (direction) => {
      await act(async () => {
        root.render(createElement(HistoryHarness, { query: "", pending: true }));
      });
      act(() => openHistorySurface({ id: "planner", title: "Plan", state: EMPTY_MAP_SURFACE_STATE }));
      if (direction === "forward") await traverseHistory(() => window.history.back());
      await act(async () => {
        root.render(createElement(HistoryHarness, { query: "Soho", pending: true }));
      });
      await traverseHistory(() => {
        if (direction === "home") closeHistorySurfaces();
        else if (direction === "forward") window.history.forward();
        else window.history.back();
      });
      expect(seedCrawlState(window.location.search).crawlId).toBe("victorian-soho");
      expect((await curatedCrawlHydrationFromSeed(window.location.search, "london"))?.crawl.id).toBe("victorian-soho");

      act(() => openHistorySurface({ id: "filters", title: "Filters", state: EMPTY_MAP_SURFACE_STATE }));
      await act(async () => {
        root.render(createElement(HistoryHarness, { query: "Soho", pending: false }));
      });
      await traverseHistory(() => window.history.back());
      expect(seedCrawlState(window.location.search).crawlId).toBe("");
    },
  );
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
    await act(async () => {
      if (close === "home") closeHistorySurfaces();
      else window.history.back();
      await landed;
    });

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
    await act(async () => {
      window.history.back();
      await landed;
    });

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
    await act(async () => {
      window.history.back();
      await landed;
    });

    expect(window.location.search).toBe("?drink=wine");
    expect(window.history.state.root).toBe(true);
  });

  it("carries Wine, max price and zone across a sheet close in Bristol", async () => {
    window.history.replaceState({ root: true }, "", "/map/bristol?q=Soho");
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
    expect(window.location.pathname).toBe("/map/bristol");

    vi.useRealTimers();
    const landed = new Promise<void>((resolve) =>
      window.addEventListener("popstate", () => resolve(), { once: true }),
    );
    await act(async () => {
      window.history.back();
      await landed;
    });

    expect(window.location.pathname).toBe("/map/bristol");
    expect(window.location.search).toBe("?q=Soho&max=6&drink=wine&zone=3");
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
    await act(async () => {
      closeHistorySurfaces();
      await landed;
    });

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
    await act(async () => {
      window.history.back();
      await landed;
    });

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
    await act(async () => {
      root.render(createElement(HistoryHarness, {
        query: "", drinkCategory: "wine", selectedVenueId: "v1",
      }));
    });
    await act(async () => {
      window.history.back();
      await vi.advanceTimersByTimeAsync(CRAWL_URL_DEBOUNCE_MS);
    });

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
    await act(async () => {
      window.history.back();
      await landed;
    });

    expect(window.location.pathname + window.location.search).toBe("/map");
  });
});

describe("selected serving crawl URL continuity", () => {
  it("keeps an explicit serving for the same category and retires it when category changes or clears", async () => {
    window.history.replaceState({}, "", "/map?drink=gin&serving=25ml&contribute=price");
    await act(async () => root.render(createElement(Harness, { query: "Brownswood", pending: false, drinkCategory: "gin" })));
    act(() => vi.advanceTimersByTime(300));
    expect(new URLSearchParams(window.location.search).get("serving")).toBe("25ml");
    expect(new URLSearchParams(window.location.search).get("contribute")).toBe("price");
    await act(async () => root.render(createElement(Harness, { query: "Brownswood", pending: false, drinkCategory: "wine" })));
    act(() => vi.advanceTimersByTime(300));
    expect(new URLSearchParams(window.location.search).has("serving")).toBe(false);
    window.history.replaceState(window.history.state, "", "/map?drink=wine&serving=125ml");
    await act(async () => root.render(createElement(Harness, { query: "Sydney", pending: false, drinkCategory: "wine" })));
    act(() => vi.advanceTimersByTime(300));
    expect(new URLSearchParams(window.location.search).get("serving")).toBe("125ml");
    await act(async () => root.render(createElement(Harness, { query: "Sydney", pending: false, drinkCategory: "" })));
    act(() => vi.advanceTimersByTime(300));
    expect(new URLSearchParams(window.location.search).has("serving")).toBe(false);
  });
});


describe("public route intent at the landed history owner", () => {
  it("keeps independent route/lens intent, then removes route intent on actual Home after manual replacement", async () => {
    window.history.replaceState({ root: true }, "", "/map?mode=build&pubs=a,b,c&routeDrink=vodka&drink=gin");
    await act(async () => root.render(createElement(HistoryHarness, {
      query: "", drinkCategory: "gin", plan: { mode: "build", builtIds: ["a", "b", "c"],
        routeDrinkIntent: { drinkCategory: "vodka", zeroProof: false } },
    })));
    act(() => vi.advanceTimersByTime(300));
    expect(new URLSearchParams(window.location.search).get("routeDrink")).toBe("vodka");
    expect(new URLSearchParams(window.location.search).get("drink")).toBe("gin");
    act(() => openHistorySurface({ id: "planner", title: "Plan", state: EMPTY_MAP_SURFACE_STATE }));
    await act(async () => root.render(createElement(HistoryHarness, {
      query: "", drinkCategory: "gin", plan: { mode: "build", builtIds: ["c", "b"], routeDrinkIntent: null },
    })));
    await traverseHistory(() => closeHistorySurfaces());
    const landed = new URLSearchParams(window.location.search);
    expect(landed.has("routeDrink")).toBe(false);
    expect(landed.has("routeLow")).toBe(false);
    expect(landed.get("drink")).toBe("gin");
    expect(landed.get("pubs")).toBe("c,b");
    expect(window.history.state.root).toBe(true);
  });
});


describe("Cider request at the mounted landed history owner", () => {
  it.each(["back", "home", "forward"].flatMap((direction) =>
    [null, "pint", "500ml"].map((drinkServing) => ({ direction, drinkServing }))))(
    "keeps newly selected Cider/$drinkServing after $direction before debounce", async ({ direction, drinkServing }) => {
    const { routeDrinkIntentFromSearch } = await import("@/lib/crawlUrl");
    const ids = ["venue-13xdb1p", "venue-companion"];
    window.history.replaceState({ root: true }, "", "/map?mode=build&pubs=venue-13xdb1p,venue-companion&drink=gin#route");
    await act(async () => root.render(createElement(HistoryHarness, {
      query: "", drinkCategory: "gin", plan: { mode: "build", builtIds: ids },
    })));
    act(() => vi.advanceTimersByTime(CRAWL_URL_DEBOUNCE_MS));
    act(() => openHistorySurface({ id: "planner", title: "Plan", state: EMPTY_MAP_SURFACE_STATE }));
    if (direction === "home") act(() => openHistorySurface({ id: "filters", title: "Filters", state: EMPTY_MAP_SURFACE_STATE }));
    if (direction === "forward") await traverseHistory(() => window.history.back());
    const historyLength = window.history.length;
    await act(async () => root.render(createElement(HistoryHarness, {
      query: "", drinkCategory: "gin", plan: { mode: "build", builtIds: ids,
        routeDrinkIntent: { drinkCategory: "beer", drinkSubtype: "beer-cider", drinkServing, zeroProof: false } },
    })));
    await traverseHistory(() => {
      if (direction === "home") closeHistorySurfaces();
      else if (direction === "forward") window.history.forward();
      else window.history.back();
    });
    const expectedIntent = { drinkCategory: "beer", drinkSubtype: "beer-cider",
      ...(drinkServing ? { drinkServing } : {}), zeroProof: false };
    expect(routeDrinkIntentFromSearch(window.location.search)).toEqual(expectedIntent);
    expect(seedCrawlState(window.location.search).routeDrinkIntent).toEqual(expectedIntent);
    expect(new URLSearchParams(window.location.search).get("routeServing")).toBe(drinkServing);
    expect(new URLSearchParams(window.location.search).get("drink")).toBe("gin");
    expect(new URLSearchParams(window.location.search).get("pubs")).toBe(ids.join(","));
    expect(window.history.length).toBe(historyLength);
    expect(window.history.state.root).toBe(true);
    expect(window.location.hash).toBe("#route");
    expect(window.location.search).not.toMatch(/pence|sourceUrl|observedAt|drinkLabel|memberToken|lat=|lng=/);
  });

  it.each([
    { direction: "back", intent: { drinkCategory: "beer" as const, zeroProof: false }, expected: null },
    { direction: "home", intent: { drinkCategory: "beer" as const, drinkSubtype: "beer-cider", drinkServing: "500ml", zeroProof: true }, expected: { zeroProof: true } },
    { direction: "forward", intent: { drinkCategory: "wine" as const, zeroProof: false }, expected: { drinkCategory: "wine", zeroProof: false } },
  ])("removes stale Cider refinements on $direction when route choice changes", async ({ direction, intent, expected }) => {
    const { routeDrinkIntentFromSearch } = await import("@/lib/crawlUrl");
    const ids = ["venue-13xdb1p", "venue-companion"];
    window.history.replaceState({ root: true }, "", "/map?mode=build&pubs=venue-13xdb1p,venue-companion&routeDrink=beer&routeSub=beer-cider&routeServing=500ml&drink=gin#route");
    await act(async () => root.render(createElement(HistoryHarness, {
      query: "", drinkCategory: "gin", plan: { mode: "build", builtIds: ids,
        routeDrinkIntent: { drinkCategory: "beer", drinkSubtype: "beer-cider", drinkServing: "500ml", zeroProof: false } },
    })));
    act(() => vi.advanceTimersByTime(CRAWL_URL_DEBOUNCE_MS));
    act(() => openHistorySurface({ id: "planner", title: "Plan", state: EMPTY_MAP_SURFACE_STATE }));
    if (direction === "home") act(() => openHistorySurface({ id: "filters", title: "Filters", state: EMPTY_MAP_SURFACE_STATE }));
    if (direction === "forward") await traverseHistory(() => window.history.back());
    await act(async () => root.render(createElement(HistoryHarness, {
      query: "", drinkCategory: "gin", plan: { mode: "build", builtIds: ids, routeDrinkIntent: intent },
    })));
    await traverseHistory(() => {
      if (direction === "home") closeHistorySurfaces();
      else if (direction === "forward") window.history.forward();
      else window.history.back();
    });
    const landed = new URLSearchParams(window.location.search);
    expect(landed.has("routeSub")).toBe(false);
    expect(landed.has("routeServing")).toBe(false);
    expect(routeDrinkIntentFromSearch(window.location.search)).toEqual(expected);
    expect(landed.get("drink")).toBe("gin");
    expect(landed.get("pubs")).toBe(ids.join(","));
    expect(window.history.state.root).toBe(true);
    expect(window.location.hash).toBe("#route");
  });
});
