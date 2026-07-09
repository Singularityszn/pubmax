"use client";

import { useEffect, useRef } from "react";

import { encodeCrawl, seedCrawlState, type CrawlUrlState } from "@/lib/crawlUrl";

// (a) seedCrawlState reads the URL once on mount for a lazy useState initializer;
// (b) useCrawlUrlSync writes crawl state back to the URL via history.replaceState,
// debounced ~300ms, so a shared link reproduces the crawl. No router dependency,
// SSR-guarded. Only WRITES to history — never calls setState (react-hooks safe).

export { seedCrawlState };

const DEBOUNCE_MS = 300;

export function useCrawlUrlSync(state: CrawlUrlState): void {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const params = new URLSearchParams(encodeCrawl(state));
      if (new URLSearchParams(window.location.search).get("log") === "1") {
        params.set("log", "1");
      }
      const query = params.toString();
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
