// @vitest-environment jsdom

import { act, createElement, useLayoutEffect, useMemo } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CRAWL_URL_DEBOUNCE_MS, useCrawlUrlSync } from "@/components/map/useCrawlUrl";
import { EMPTY_MAP_SURFACE_STATE, useMapSurfaceNavigation } from "@/components/map/pubmap/useMapSurfaceNavigation";
import { seedCrawlState, type CrawlUrlState } from "@/lib/crawlUrl";
import { curatedCrawlHydrationFromSeed } from "@/lib/mapSeedCrawl";
import { buildMapSeed } from "@/lib/pubMap";
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
  crawlStyle = initialFilters.crawlStyle,
  maxPrice = initialFilters.maxPrice,
  zone = initialFilters.zone,
  plan,
  pending = false,
}: {
  query: string;
  drinkCategory?: Filters["drinkCategory"];
  selectedVenueId?: string;
  holdCleanUrl?: boolean;
  crawlStyle?: Filters["crawlStyle"];
  maxPrice?: number;
  zone?: Filters["zone"];
  plan?: Pick<CrawlUrlState, "mode" | "builtIds" | "crawlId">;
  pending?: boolean;
}) {
  const state = useMemo(() => {
    const current = mapState(query, drinkCategory, selectedVenueId);
    return { ...current, ...plan, filters: { ...current.filters, crawlStyle, maxPrice, zone } };
  }, [query, drinkCategory, selectedVenueId, crawlStyle, maxPrice, zone, plan]);
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


describe("completed Beer share intent during actual URL synchronization", () => {
  const plan = { mode: "build" as const, builtIds: ["pub-a", "pub-b"] };

  it("retains explicit Beer after the debounce and selection-only changes", async () => {
    window.history.replaceState({ root: true }, "", "/map?mode=build&pubs=pub-a,pub-b&drink=beer#route");
    await act(async () => root.render(createElement(HistoryHarness, { query: "", plan })));
    act(() => vi.advanceTimersByTime(300));
    expect(new URLSearchParams(window.location.search).get("drink")).toBe("beer");
    await act(async () => root.render(createElement(HistoryHarness, {
      query: "", plan: { ...plan, crawlId: "chosen-crawl" }, selectedVenueId: "pub-a",
    })));
    act(() => vi.advanceTimersByTime(300));
    const params = new URLSearchParams(window.location.search);
    expect(params.get("drink")).toBe("beer");
    expect(params.get("pubs")).toBe("pub-a,pub-b");
    expect(params.get("sel")).toBe("pub-a");
    expect(params.get("crawl")).toBe("chosen-crawl");
    expect(window.location.hash).toBe("#route");
    expect(window.history.state.root).toBe(true);
  });

  it("retains Beer across actual curated hydration and a landed history flush", async () => {
    const stops = "venue-1ufn31x,venue-1t8siin,venue-xiesdn,venue-phqazo,venue-15i2wst";
    const arrival = `?drink=beer&mode=build&pubs=${stops}&crawl=victorian-soho`;
    const eager = buildMapSeed(arrival, "london");
    const hydration = await curatedCrawlHydrationFromSeed(arrival, "london");
    expect(eager.filters.crawlStyle).toBe("balanced");
    expect(hydration?.filters.crawlStyle).toBe("heritage");
    expect(hydration?.crawl.venueIds).toEqual(stops.split(","));
    window.history.replaceState({ root: true }, "", `/map${arrival}#route`);
    await act(async () => root.render(createElement(HistoryHarness, {
      query: "", pending: true,
      plan: { mode: eager.mode, builtIds: eager.builtIds },
      crawlStyle: eager.filters.crawlStyle,
    })));
    act(() => openHistorySurface({ id: "planner", title: "Plan", state: EMPTY_MAP_SURFACE_STATE }));
    await act(async () => root.render(createElement(HistoryHarness, {
      query: "", pending: false,
      plan: { mode: "build", builtIds: hydration!.crawl.venueIds, crawlId: hydration!.crawl.id },
      crawlStyle: hydration!.filters.crawlStyle,
    })));
    await traverseHistory(() => closeHistorySurfaces());
    const params = new URLSearchParams(window.location.search);
    expect(params.get("drink")).toBe("beer");
    expect(params.get("pubs")).toBe(stops);
    expect(params.get("style")).toBe("heritage");
    expect(params.get("crawl")).toBe("victorian-soho");
    expect(window.location.hash).toBe("#route");
    expect(window.history.state.root).toBe(true);
    act(() => vi.advanceTimersByTime(600));
    expect(new URLSearchParams(window.location.search).get("drink")).toBe("beer");
  });

  it("releases Beer on a later style edit and never resurrects it", async () => {
    const arrival = "?drink=beer&mode=build&pubs=pub-a,pub-b&crawl=chosen-crawl";
    window.history.replaceState({}, "", `/map${arrival}`);
    await act(async () => root.render(createElement(HistoryHarness, {
      query: "", plan, pending: true,
    })));
    const hydratedPlan = { ...plan, crawlId: "chosen-crawl" };
    await act(async () => root.render(createElement(HistoryHarness, {
      query: "", plan: hydratedPlan, pending: false, crawlStyle: "heritage",
    })));
    act(() => vi.advanceTimersByTime(300));
    expect(new URLSearchParams(window.location.search).get("drink")).toBe("beer");
    await act(async () => root.render(createElement(HistoryHarness, {
      query: "", plan: hydratedPlan, crawlStyle: "balanced",
    })));
    act(() => vi.advanceTimersByTime(300));
    expect(new URLSearchParams(window.location.search).get("drink")).toBeNull();
    await act(async () => root.render(createElement(HistoryHarness, {
      query: "", plan: hydratedPlan, crawlStyle: "heritage",
    })));
    act(() => vi.advanceTimersByTime(300));
    expect(new URLSearchParams(window.location.search).get("drink")).toBeNull();
  });

  it("releases Beer if pending hydration ends without a resolved identity", async () => {
    window.history.replaceState({}, "", "/map?drink=beer&mode=build&pubs=pub-a,pub-b");
    await act(async () => root.render(createElement(HistoryHarness, { query: "", plan, pending: true })));
    await act(async () => root.render(createElement(HistoryHarness, {
      query: "", plan, pending: false, crawlStyle: "heritage",
    })));
    act(() => vi.advanceTimersByTime(300));
    expect(new URLSearchParams(window.location.search).get("drink")).toBeNull();
  });

  it("does not restore Beer when a reader edits style before hydration finishes", async () => {
    window.history.replaceState({}, "", "/map?drink=beer&mode=build&pubs=pub-a,pub-b");
    await act(async () => root.render(createElement(HistoryHarness, { query: "", plan, pending: true })));
    await act(async () => root.render(createElement(HistoryHarness, {
      query: "", plan, pending: true, crawlStyle: "heritage",
    })));
    await act(async () => root.render(createElement(HistoryHarness, {
      query: "", plan: { ...plan, crawlId: "chosen-crawl" }, pending: false, crawlStyle: "heritage",
    })));
    act(() => vi.advanceTimersByTime(300));
    expect(new URLSearchParams(window.location.search).get("drink")).toBeNull();
  });

  it("does not resurrect a shared Beer intent after a context change", async () => {
    window.history.replaceState({}, "", "/map?mode=build&pubs=pub-a,pub-b&drink=beer");
    await act(async () => root.render(createElement(HistoryHarness, { query: "", plan })));
    act(() => vi.advanceTimersByTime(300));
    await act(async () => root.render(createElement(HistoryHarness, { query: "Soho", plan })));
    act(() => vi.advanceTimersByTime(300));
    expect(new URLSearchParams(window.location.search).get("drink")).toBeNull();
    expect(new URLSearchParams(window.location.search).get("q")).toBe("Soho");
    await act(async () => root.render(createElement(HistoryHarness, { query: "", plan })));
    act(() => vi.advanceTimersByTime(300));
    expect(new URLSearchParams(window.location.search).get("drink")).toBeNull();
  });

  it("allows a new drink lane to replace explicit Beer", async () => {
    window.history.replaceState({}, "", "/map?mode=build&pubs=pub-a,pub-b&drink=beer");
    await act(async () => root.render(createElement(HistoryHarness, { query: "", plan })));
    act(() => vi.advanceTimersByTime(300));
    await act(async () => root.render(createElement(HistoryHarness, { query: "", plan, drinkCategory: "wine" })));
    act(() => vi.advanceTimersByTime(300));
    expect(new URLSearchParams(window.location.search).get("drink")).toBe("wine");
  });

  it("releases explicit Beer when the stop order changes", async () => {
    window.history.replaceState({}, "", "/map?mode=build&pubs=pub-a,pub-b&drink=beer");
    await act(async () => root.render(createElement(HistoryHarness, { query: "", plan })));
    act(() => vi.advanceTimersByTime(300));
    expect(new URLSearchParams(window.location.search).get("drink")).toBe("beer");
    await act(async () => root.render(createElement(HistoryHarness, {
      query: "", plan: { mode: "build", builtIds: ["pub-b", "pub-a"] },
    })));
    act(() => vi.advanceTimersByTime(300));
    const params = new URLSearchParams(window.location.search);
    expect(params.get("drink")).toBeNull();
    expect(params.get("pubs")).toBe("pub-b,pub-a");
  });

  it.each([
    "?mode=build&pubs=pub-a,pub-b",
    "?drink=wine&mode=build&pubs=pub-a,pub-b",
    "?drink=beer&mode=build&pubs=pub-a,pub-b&brand=AMSTEL",
    "?drink=beer&mode=build&pubs=pub-a",
    "?drink=beer&mode=build&pubs=pub-a,pub-a",
    "?drink=beer",
  ])("does not invent Beer share intent for %s", async (arrival) => {
    window.history.replaceState({}, "", `/map${arrival}`);
    await act(async () => root.render(createElement(HistoryHarness, { query: "", plan })));
    act(() => vi.advanceTimersByTime(300));
    expect(new URLSearchParams(window.location.search).get("drink")).toBeNull();
  });

  it("keeps explicit Beer when the planner closes before the debounce", async () => {
    window.history.replaceState({ root: true }, "", "/map?mode=build&pubs=pub-a,pub-b&drink=beer#route");
    await act(async () => root.render(createElement(HistoryHarness, { query: "", plan })));
    act(() => openHistorySurface({ id: "planner", title: "Plan", state: EMPTY_MAP_SURFACE_STATE }));
    await traverseHistory(() => closeHistorySurfaces());
    const params = new URLSearchParams(window.location.search);
    expect(params.get("drink")).toBe("beer");
    expect(params.get("pubs")).toBe("pub-a,pub-b");
    expect(window.location.hash).toBe("#route");
    expect(window.history.state.root).toBe(true);
  });
});
