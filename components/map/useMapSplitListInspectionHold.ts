"use client";

import { useCallback, useEffect, useLayoutEffect, useReducer, useRef, type RefObject } from "react";
import { transitionMapSplitListInspection } from "@/lib/mapSplitListInspection";
import type { MapSplitListMap } from "./MapSplitList";
import type { MapSplitListPointerView } from "./useMapSplitListPointerHold";

/** Keep the list a reader left until its map returns, or they choose a new view. */
export function useMapSplitListInspectionHold({
  current, detailOpen, filterState, map, viewSettled, scrollRef,
}: {
  current: MapSplitListPointerView;
  detailOpen: boolean;
  filterState: object | undefined;
  map: MapSplitListMap | null;
  viewSettled: boolean;
  scrollRef: RefObject<HTMLDivElement | null>;
}) {
  const [inspection, dispatch] = useReducer(transitionMapSplitListInspection<MapSplitListPointerView>, { phase: "following" });
  const held = inspection.phase === "following" ? null : inspection.view;
  const restoreScrollTop = useRef<number | null>(null);
  const previousView = useRef(current);
  const previousOpen = useRef(detailOpen);
  const previousFilters = useRef(filterState);
  const release = useCallback(() => {
    restoreScrollTop.current = null;
    dispatch({ type: "released" });
  }, []);

  useLayoutEffect(() => {
    const filtersChanged = previousFilters.current !== filterState;
    previousFilters.current = filterState;
    if (filtersChanged) {
      release();
    } else if (detailOpen && !previousOpen.current && previousView.current.groups.total > 0) {
      dispatch({ type: "opened", view: previousView.current, scrollTop: scrollRef.current?.scrollTop ?? 0 });
    } else if (!detailOpen && previousOpen.current) {
      dispatch({ type: "closed" });
    }
    previousOpen.current = detailOpen;
    if (!detailOpen && held === null) previousView.current = current;
  }, [current, detailOpen, filterState, held, release, scrollRef]);

  useEffect(() => {
    if (!held || !map) return;
    let active = true;
    const idle = () => { if (!detailOpen) dispatch({ type: "map_idle" }); };
    const moved = (event: { originalEvent?: unknown }) => {
      if (event.originalEvent) release();
    };
    map.on("idle", idle);
    map.on("movestart", moved);
    // Closing a drawer on an already idle map does not cause another idle event.
    queueMicrotask(() => {
      if (active && !detailOpen && map.loaded?.() === true && map.isMoving?.() === false) idle();
    });
    return () => {
      active = false;
      map.off("idle", idle);
      map.off("movestart", moved);
    };
  }, [detailOpen, held, map, release]);

  useEffect(() => {
    // Clear the snapshot once the external map and its debounced rows agree.
    if (inspection.phase === "settling" && !detailOpen && viewSettled) {
      restoreScrollTop.current = inspection.scrollTop;
      dispatch({ type: "view_settled" });
    }
  }, [detailOpen, inspection, viewSettled]);

  useLayoutEffect(() => {
    if (held !== null || restoreScrollTop.current === null) return;
    if (scrollRef.current) scrollRef.current.scrollTop = restoreScrollTop.current;
    restoreScrollTop.current = null;
  }, [current, held, scrollRef]);

  return { displayed: held ?? current, release };
}
