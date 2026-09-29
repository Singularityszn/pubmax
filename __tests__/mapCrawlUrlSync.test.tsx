// @vitest-environment jsdom

import { act, createElement, useMemo } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useCrawlUrlSync } from "@/components/map/useCrawlUrl";
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
  it("keeps a changed drink lens shareable when Back closes its sheet", async () => {
    window.history.replaceState({ root: true }, "", "/map");
    await act(async () => {
      root.render(createElement(Harness, { query: "", pending: false }));
    });
    window.history.pushState({ sheet: true }, "", "/map");
    await act(async () => {
      root.render(createElement(Harness, { query: "", pending: false, drinkCategory: "wine" }));
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
    expect(window.history.state).toEqual({ root: true });
  });

  it("updates the drink lens without putting a closed venue back in the URL", async () => {
    window.history.replaceState({ root: true }, "", "/map?q=Soho");
    await act(async () => {
      root.render(createElement(Harness, {
        query: "Soho", pending: false, drinkCategory: "cocktail",
      }));
    });
    window.history.pushState({ venue: true }, "", "/map?q=Soho&sel=v1");
    await act(async () => {
      root.render(createElement(Harness, {
        query: "Soho",
        pending: false,
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
    expect(window.history.state).toEqual({ root: true });
  });

  it("keeps a clean arrival clean until the reader changes the saved lens", async () => {
    window.history.replaceState({ root: true }, "", "/map");
    await act(async () => {
      root.render(createElement(Harness, {
        query: "", pending: false, drinkCategory: "wine", holdCleanUrl: true,
      }));
    });
    window.history.pushState({ sheet: true }, "", "/map");

    vi.useRealTimers();
    const landed = new Promise<void>((resolve) =>
      window.addEventListener("popstate", () => resolve(), { once: true }),
    );
    window.history.back();
    await landed;

    expect(window.location.pathname + window.location.search).toBe("/map");
  });
});
