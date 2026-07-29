"use client";

import { useEffect, useLayoutEffect, useRef } from "react";

import {
  browseSelectionUrl,
  cleanMapUrl,
  isSelectionSentinel,
  searchHasSelection,
  selectionSentinelVenueId,
  selectionTransition,
  withSelectionSentinel,
} from "@/lib/mapSelectionHistory";

// Selection-history sentinel wiring (trusted-handoff §4.6).
//
// Gives the Map an exact Back contract without touching every close call site:
// the hook watches `selectedVenueId` and owns the `sel` history entry.
//
//   - Incoming selected arrival (`/map?sel=…`): freeze the arrival URL, replace
//     the incoming entry with a clean Map (owned params preserved), then push a
//     selected entry stamped with the sentinel. History becomes
//     [previous page, clean /map, /map?sel=X]. StrictMode-guarded so the double
//     invoke never double-pushes, and a duplicated tab recreates exactly one
//     checkpoint.
//   - In-Map: the first selection pushes one entry; switching Venue replaces it
//     (only ever one selected entry above the clean Map).
//   - Close: when the current entry owns the sentinel we pop it with Back — so a
//     single Back closes the sheet and reveals the clean Map, and a second Back
//     leaves the Map. When no sentinel is owned we strip sel/accept/src in place.
//   - Browser Back while a Venue is open lands on the clean entry; the popstate
//     handler closes the sheet, and prevRef is pre-cleared so the resulting
//     state change never issues a second Back.
//
// The pure decisions live in lib/mapSelectionHistory.ts; this file only applies
// them to window.history. It never calls setState in an effect body — only from
// the popstate listener it registers — matching the repo's react-hooks rule.

type MapSelectionHistoryArgs = {
  /** The arrival query string, frozen once at mount by the caller. */
  arrivalSearch: string;
  /** The current inspected Venue id ("" when none). */
  selectedVenueId: string;
  /**
   * The `at=` location companion for the current selection
   * (lib/mapSelectionHistory formatSelectionHint) — set for a UK base pub,
   * "" otherwise. Written with the sel entry so a shared/reloaded base link
   * can stream the right shard cell; read via a ref so a hint change alone
   * never rewrites history.
   */
  selectionHint?: string;
  /** Close the sheet when a browser Back pops the selected entry. */
  onBackClose: () => void;
};

export function useMapSelectionHistory({
  arrivalSearch,
  selectedVenueId,
  selectionHint = "",
  onBackClose,
}: MapSelectionHistoryArgs): void {
  // The last selectedVenueId we reconciled into history. Seeded by the arrival
  // effect so the first transition run is a no-op for a seeded selection.
  const prevRef = useRef<string>("");
  const checkpointedRef = useRef(false);
  const pendingBackRef = useRef(false);
  const onBackCloseRef = useRef(onBackClose);
  const selectedVenueIdRef = useRef(selectedVenueId);
  const selectionHintRef = useRef(selectionHint);
  useLayoutEffect(() => {
    onBackCloseRef.current = onBackClose;
    selectedVenueIdRef.current = selectedVenueId;
    selectionHintRef.current = selectionHint;
  }, [onBackClose, selectedVenueId, selectionHint]);

  // 1) Arrival checkpoint — once, before useCrawlUrlSync's first (debounced)
  //    write. Empty deps: the frozen arrival is all this needs.
  useEffect(() => {
    if (checkpointedRef.current) return;
    checkpointedRef.current = true;
    if (typeof window === "undefined") return;

    if (!searchHasSelection(arrivalSearch)) {
      // A restored-session Venue has no URL sel and no sentinel entry; just
      // record it so a later close strips rather than trying to pop.
      prevRef.current = selectedVenueId;
      return;
    }

    const { pathname, search, hash } = window.location;
    const arrivalUrl = `${pathname}${search}${hash}`;
    const venueId =
      new URLSearchParams(search.startsWith("?") ? search.slice(1) : search).get("sel") ??
      selectedVenueId;
    // Replace the incoming selected entry with a clean Map (owned params kept),
    // then push the exact arrival URL back on top carrying the sentinel.
    window.history.replaceState(window.history.state, "", cleanMapUrl(pathname, search, hash));
    window.history.pushState(withSelectionSentinel(window.history.state, venueId), "", arrivalUrl);
    prevRef.current = venueId;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once at mount
  }, []);

  // 2) Transition — push / replace / back / strip as selectedVenueId changes.
  useLayoutEffect(() => {
    if (typeof window === "undefined") return;
    if (!checkpointedRef.current) return;
    if (pendingBackRef.current) return;
    const prev = prevRef.current;
    const next = selectedVenueId;
    if (next === prev) return;

    const action = selectionTransition({
      prev,
      next,
      currentEntryOwnsSentinel: isSelectionSentinel(window.history.state),
    });
    const { pathname, search, hash } = window.location;
    switch (action.kind) {
      case "push":
        window.history.pushState(
          withSelectionSentinel(window.history.state, action.venueId),
          "",
          browseSelectionUrl(pathname, search, action.venueId, hash, selectionHintRef.current),
        );
        break;
      case "replace":
        window.history.replaceState(
          withSelectionSentinel(window.history.state, action.venueId),
          "",
          browseSelectionUrl(pathname, search, action.venueId, hash, selectionHintRef.current),
        );
        break;
      case "back":
        pendingBackRef.current = true;
        window.history.back();
        break;
      case "strip":
        window.history.replaceState(
          window.history.state,
          "",
          cleanMapUrl(pathname, search, hash),
        );
        break;
      case "none":
        break;
    }
    prevRef.current = next;
  }, [selectedVenueId]);

  // 3) Browser Back / Forward — when we land on a non-sentinel entry while a
  //    Venue is still open, Back should close the sheet. Pre-clear prevRef so
  //    the resulting selectedVenueId change is a no-op transition (never a
  //    second Back). Landing on a sentinel entry needs no action here; the URL
  //    sel drives re-selection through useSelParamSync.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onPop = () => {
      if (pendingBackRef.current) {
        pendingBackRef.current = false;
        const queuedVenueId = selectedVenueIdRef.current;
        if (!queuedVenueId) return;
        const { pathname, search, hash } = window.location;
        window.history.pushState(
          withSelectionSentinel(window.history.state, queuedVenueId),
          "",
          browseSelectionUrl(
            pathname,
            search,
            queuedVenueId,
            hash,
            selectionHintRef.current,
          ),
        );
        prevRef.current = queuedVenueId;
        return;
      }
      if (selectionSentinelVenueId(window.history.state) !== null) return;
      if (!prevRef.current) return;
      prevRef.current = "";
      onBackCloseRef.current();
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
}
