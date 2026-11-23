"use client";

import { useEffect, useRef, useState } from "react";

import { trackEvent } from "@/lib/analytics";

export const NO_RESULTS_MESSAGE = "Nothing matching that. Try a pub name or an area.";
const NO_RESULTS_ANNOUNCE_DELAY_MS = 300;

/**
 * A typed search that settled with nothing to show. The empty line shows at
 * once. The live region speaks it, and analytics counts it, only once the
 * miss has held for a moment, and only once per query.
 */
export function useMapSearchMiss({
  showPanel,
  trimmed,
  deferredTrimmed,
  querySettled,
  searchIndexLoading,
  hasResults,
}: {
  showPanel: boolean;
  trimmed: string;
  deferredTrimmed: string;
  querySettled: boolean;
  searchIndexLoading: boolean;
  hasResults: boolean;
}): { showEmptyLine: boolean; liveAnnouncement: string } {
  const [announcedQuery, setAnnouncedQuery] = useState("");
  const lastAnnouncedQuery = useRef("");
  const showEmptyLine =
    showPanel &&
    trimmed.length > 0 &&
    querySettled &&
    !searchIndexLoading &&
    !hasResults;

  useEffect(() => {
    if (!showEmptyLine) {
      if (trimmed.length === 0 || hasResults) lastAnnouncedQuery.current = "";
      return;
    }

    const normalized = deferredTrimmed.toLocaleLowerCase();
    if (lastAnnouncedQuery.current === normalized) return;

    const timer = window.setTimeout(() => {
      lastAnnouncedQuery.current = normalized;
      setAnnouncedQuery(normalized);
      // Fixed-schema, zero-property event: raw search text never enters telemetry.
      trackEvent("map_search_no_results");
    }, NO_RESULTS_ANNOUNCE_DELAY_MS);

    return () => window.clearTimeout(timer);
  }, [deferredTrimmed, hasResults, showEmptyLine, trimmed.length]);

  const liveAnnouncement =
    showEmptyLine && announcedQuery === deferredTrimmed.toLocaleLowerCase() ? NO_RESULTS_MESSAGE : "";
  return { showEmptyLine, liveAnnouncement };
}
