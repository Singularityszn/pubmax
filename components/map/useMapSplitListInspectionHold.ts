"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
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
  const [held, setHeld] = useState<MapSplitListPointerView | null>(null);
  const [returnIdle, setReturnIdle] = useState(false);
  const savedScrollTop = useRef(0);
  const restoreScrollTop = useRef<number | null>(null);
  const previousView = useRef(current);
  const previousOpen = useRef(detailOpen);
  const previousFilters = useRef(filterState);
  const release = useCallback(() => {
    restoreScrollTop.current = null;
    setHeld(null);
    setReturnIdle(false);
  }, []);

  useLayoutEffect(() => {
    const filtersChanged = previousFilters.current !== filterState;
    previousFilters.current = filterState;
    if (filtersChanged) {
      release();
    } else if (detailOpen && !previousOpen.current && previousView.current.groups.total > 0) {
      savedScrollTop.current = scrollRef.current?.scrollTop ?? 0;
      setHeld(previousView.current);
      setReturnIdle(false);
    }
    previousOpen.current = detailOpen;
    if (!detailOpen && held === null) previousView.current = current;
  }, [current, detailOpen, filterState, held, release, scrollRef]);

  useEffect(() => {
    if (!held || !map) return;
    const container = map.getContainer();
    const stage = container.closest(".mapStage") ?? container;
    let active = true;
    const idle = () => { if (!detailOpen) setReturnIdle(true); };
    map.on("idle", idle);
    // Closing a drawer on an already idle map does not cause another idle event.
    queueMicrotask(() => {
      if (active && !detailOpen && map.loaded?.() === true && map.isMoving?.() === false) idle();
    });
    stage.addEventListener("pointerdown", release, true);
    stage.addEventListener("wheel", release, true);
    stage.addEventListener("keydown", release, true);
    return () => {
      active = false;
      map.off("idle", idle);
      stage.removeEventListener("pointerdown", release, true);
      stage.removeEventListener("wheel", release, true);
      stage.removeEventListener("keydown", release, true);
    };
  }, [detailOpen, held, map, release]);

  useEffect(() => {
    // Clear the snapshot once the external map and its debounced rows agree.
    if (held && !detailOpen && returnIdle && viewSettled) {
      const top = savedScrollTop.current;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- release the snapshot after the external map settles
      release();
      restoreScrollTop.current = top;
    }
  }, [detailOpen, held, release, returnIdle, viewSettled]);

  useLayoutEffect(() => {
    if (held !== null || restoreScrollTop.current === null) return;
    if (scrollRef.current) scrollRef.current.scrollTop = restoreScrollTop.current;
    restoreScrollTop.current = null;
  }, [current, held, scrollRef]);

  return { displayed: held ?? current, release };
}
