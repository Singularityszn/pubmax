"use client";

import { useCallback, useEffect, useRef } from "react";

import { encodeCrawl, seedCrawlState, type CrawlUrlState } from "@/lib/crawlUrl";
import { isDrinkShapeArrival } from "@/lib/mapArrival";

// (a) seedCrawlState reads the URL once on mount for a lazy useState initializer;
// (b) useCrawlUrlSync writes crawl state back to the URL via history.replaceState,
// debounced ~300ms, so a shared link reproduces the crawl. No router dependency,
// SSR-guarded. Only WRITES to history — never calls setState (react-hooks safe).

export { seedCrawlState };

export const CRAWL_URL_DEBOUNCE_MS = 300;

// Owned Map params that encodeCrawl does not model but must survive a URL sync:
// the Drop-intent flag, planner deep link, Map-owner selection, accepted-handoff markers,
// and a base-pub selection's `at=` location hint
// (lib/mapSelectionHistory), and the honest UK place arrival coordinates.
// Without this merge the debounced replaceState would silently drop them the
// moment any crawl state changed.
const OWNED_PASSTHROUGH_PARAMS = [
  "log",
  "contribute",
  "plan",
  "sel",
  "accept",
  "src",
  "at",
  "place",
  "lat",
  "lng",
  "uk",
  "mapNotice",
] as const;

export function mergeCrawlUrlSearch(
  encodedSearch: string,
  liveSearch: string,
  preserveCrawlParam = false,
  preserveBeerParam = false,
): string {
  const params = new URLSearchParams(encodedSearch);
  const live = new URLSearchParams(liveSearch);
  for (const key of OWNED_PASSTHROUGH_PARAMS) {
    const value = live.get(key);
    if (value !== null && !params.has(key)) params.set(key, value);
  }
  const crawl = live.get("crawl");
  if (preserveCrawlParam && crawl !== null && !params.has("crawl")) {
    params.set("crawl", crawl);
  }
  if (preserveBeerParam && live.get("drink") === "beer" && !params.has("drink")
    && !isDrinkShapeArrival(liveSearch)) {
    params.set("drink", "beer");
  }
  return params.toString();
}

/**
 * The address a clean arrival is allowed to keep, until the reader changes
 * something themselves.
 *
 * A restored session put a previous visit's search back on the map, and the
 * sync then wrote it to the address bar: a typed `/map` became `/map?q=Camden`,
 * and a clean shared link mutated into somebody's stale search. The address the
 * reader typed wins. `encodedAtMount` is what the restored state encodes to, so
 * the first genuine change by the reader releases the hold and the sync resumes.
 */
export type CleanUrlHold = { encodedAtMount: string } | null;

/** May the sync write `encoded` to the address bar yet? */
export function crawlUrlWriteAllowed(
  hold: CleanUrlHold,
  encoded: string,
): boolean {
  return hold === null || encoded !== hold.encodedAtMount;
}

function writeCrawlUrl(encoded: string, preserveCrawlParam: boolean, preserveBeerParam: boolean): void {
  const query = mergeCrawlUrlSearch(
    encoded,
    window.location.search,
    preserveCrawlParam,
    preserveBeerParam,
  );
  const url = query
    ? `${window.location.pathname}?${query}${window.location.hash}`
    : `${window.location.pathname}${window.location.hash}`;
  if (`${window.location.pathname}${window.location.search}${window.location.hash}` !== url) {
    window.history.replaceState(window.history.state, "", url);
  }
}

// Filter and plan keys from encodeCrawl, excluding selection and surface keys.
const CRAWL_CONTEXT_PARAMS = [
  "mode", "style", "max", "stops", "win", "drops", "low",
  "cocktails", "food", "q", "drink", "brand", "sub", "topshelf",
  "zone", "pubs", "band", "alt", "crawl",
] as const;

function writeLandedCrawlContext(encoded: string, preserveCrawlParam: boolean, preserveBeerParam: boolean): void {
  // The landed entry owns selection, intents and place context. Only Map
  // filters changed while a surface was open cross this history boundary.
  const live = new URLSearchParams(window.location.search);
  const selected = new URLSearchParams(mergeCrawlUrlSearch(
    encoded, window.location.search, preserveCrawlParam, preserveBeerParam,
  ));
  for (const key of CRAWL_CONTEXT_PARAMS) {
    const value = selected.get(key);
    if (key === "crawl" && preserveCrawlParam && value === null) continue;
    if (value === null) live.delete(key);
    else live.set(key, value);
  }
  const query = live.toString();
  const url = `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`;
  if (`${window.location.pathname}${window.location.search}${window.location.hash}` !== url) {
    window.history.replaceState(window.history.state, "", url);
  }
}

export function useCrawlUrlSync(
  state: CrawlUrlState,
  /** True when the reader arrived on a clean URL and a saved session was
   *  restored over it. The address then stays clean until they act. */
  holdCleanUrl = false,
  holdSeededCrawlParam = false,
): () => void {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const hold = useRef<CleanUrlHold | undefined>(undefined);
  const crawlHold = useRef<CleanUrlHold | undefined>(undefined);
  const beerShareHold = useRef<CleanUrlHold | undefined>(undefined);
  const latestWrite = useRef<{
    encoded: string; preserveCrawlParam: boolean; preserveBeerParam: boolean;
  } | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const encoded = encodeCrawl(state);
    // Keep a shared explicit default only for its original plan context.
    // Selection and hydrated curated identity do not change the drink choice.
    const beerContextParams = new URLSearchParams(encoded);
    for (const key of ["sel", "landmark", "crawl"]) beerContextParams.delete(key);
    const beerContext = beerContextParams.toString();
    if (beerShareHold.current === undefined) {
      const live = new URLSearchParams(window.location.search);
      const candidate = new URLSearchParams(beerContext);
      const isDefaultLane = !candidate.has("drink");
      candidate.set("drink", "beer");
      beerShareHold.current = isDefaultLane && live.get("drink") === "beer"
        && !isDrinkShapeArrival(window.location.search)
        && !isDrinkShapeArrival(`?${candidate}`)
        ? { encodedAtMount: beerContext } : null;
    }
    if (beerShareHold.current !== null && beerShareHold.current.encodedAtMount !== beerContext) {
      const original = new URLSearchParams(beerShareHold.current.encodedAtMount);
      const hydrated = new URLSearchParams(beerContext);
      for (const key of ["style", "alt"]) {
        original.delete(key);
        hydrated.delete(key);
      }
      // The pending catalogue lookup may supply its style and display with
      // its first resolved identity. Every other plan choice must still match.
      const resolvedCuratedContext = crawlHold.current != null
        && !holdSeededCrawlParam && Boolean(state.crawlId)
        && !new URLSearchParams(crawlHold.current.encodedAtMount).has("crawl")
        && original.toString() === hydrated.toString();
      beerShareHold.current = resolvedCuratedContext ? { encodedAtMount: beerContext } : null;
    }
    const preserveBeerParam = beerShareHold.current !== null;
    if (hold.current === undefined) {
      hold.current = holdCleanUrl ? { encodedAtMount: encoded } : null;
    }
    if (crawlHold.current === undefined) {
      crawlHold.current = holdSeededCrawlParam ? { encodedAtMount: encoded } : null;
    }
    if (!crawlUrlWriteAllowed(hold.current, encoded)) {
      latestWrite.current = null;
      return;
    }
    hold.current = null;
    const preserveCrawlParam =
      crawlHold.current !== null &&
      crawlHold.current !== undefined &&
      holdSeededCrawlParam;
    if (!holdSeededCrawlParam) crawlHold.current = null;
    latestWrite.current = { encoded, preserveCrawlParam, preserveBeerParam };
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => writeCrawlUrl(encoded, preserveCrawlParam, preserveBeerParam), CRAWL_URL_DEBOUNCE_MS);

    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [holdCleanUrl, holdSeededCrawlParam, state]);

  return useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    if (latestWrite.current !== null) {
      const { encoded, preserveCrawlParam, preserveBeerParam } = latestWrite.current;
      writeLandedCrawlContext(encoded, preserveCrawlParam, preserveBeerParam);
    }
  }, []);
}
