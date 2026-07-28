"use client";

import { useEffect, useRef } from "react";

import { encodeCrawl, seedCrawlState, type CrawlUrlState } from "@/lib/crawlUrl";

// (a) seedCrawlState reads the URL once on mount for a lazy useState initializer;
// (b) useCrawlUrlSync writes crawl state back to the URL via history.replaceState,
// debounced ~300ms, so a shared link reproduces the crawl. No router dependency,
// SSR-guarded. Only WRITES to history — never calls setState (react-hooks safe).

export { seedCrawlState };

const DEBOUNCE_MS = 300;

// Owned Map params that encodeCrawl does not model but must survive a URL sync:
// the Drop-intent flag, the planner deep link, the accepted-handoff markers
// (trusted-handoff §4.6), a base-pub selection's `at=` location hint
// (lib/mapSelectionHistory), and the honest UK place arrival coordinates.
// Without this merge the debounced replaceState would silently drop them the
// moment any crawl state changed.
const OWNED_PASSTHROUGH_PARAMS = [
  "log",
  "plan",
  "accept",
  "src",
  "at",
  "place",
  "lat",
  "lng",
] as const;

export function mergeCrawlUrlSearch(
  encodedSearch: string,
  liveSearch: string,
): string {
  const params = new URLSearchParams(encodedSearch);
  const live = new URLSearchParams(liveSearch);
  for (const key of OWNED_PASSTHROUGH_PARAMS) {
    const value = live.get(key);
    if (value !== null && !params.has(key)) params.set(key, value);
  }
  return params.toString();
}

export function useCrawlUrlSync(state: CrawlUrlState): void {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const query = mergeCrawlUrlSearch(
        encodeCrawl(state),
        window.location.search,
      );
      // Keep a clean pathname when nothing meaningful is encoded (no trailing `?`).
      const url = query
        ? `${window.location.pathname}?${query}${window.location.hash}`
        : `${window.location.pathname}${window.location.hash}`;
      if (`${window.location.pathname}${window.location.search}${window.location.hash}` === url) {
        return;
      }
      window.history.replaceState(window.history.state, "", url);
    }, DEBOUNCE_MS);

    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [state]);
}
