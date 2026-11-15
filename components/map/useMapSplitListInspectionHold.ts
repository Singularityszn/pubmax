"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { MapSplitListMap } from "./MapSplitList";
import type { MapSplitListPointerView } from "./useMapSplitListPointerHold";

/** Keep the list a reader left until its map returns, or they choose a new view. */
export function useMapSplitListInspectionHold({
  current, detailOpen, filterState, map, viewSettled,
}: {
  current: MapSplitListPointerView;
  detailOpen: boolean;
  filterState: object | undefined;
  map: MapSplitListMap | null;
  viewSettled: boolean;
}) {
  const [held, setHeld] = useState<MapSplitListPointerView | null>(null);
  const [returnIdle, setReturnIdle] = useState(false);
  const previousView = useRef(current);
  const previousOpen = useRef(detailOpen);
  const previousFilters = useRef(filterState);
  const release = useCallback(() => {
    setHeld(null);
    setReturnIdle(false);
  }, []);

  useLayoutEffect(() => {
    const filtersChanged = previousFilters.current !== filterState;
    previousFilters.current = filterState;
    if (filtersChanged) {
      release();
    } else if (detailOpen && !previousOpen.current && previousView.current.groups.total > 0) {
      setHeld(previousView.current);
      setReturnIdle(false);
    }
    previousOpen.current = detailOpen;
    if (!detailOpen && held === null) previousView.current = current;
  }, [current, detailOpen, filterState, held, release]);

  useEffect(() => {
    if (!held || !map) return;
    const container = map.getContainer();
    const stage = container.closest(".mapStage") ?? container;
    const idle = () => { if (!detailOpen) setReturnIdle(true); };
    map.on("idle", idle);
    stage.addEventListener("pointerdown", release, true);
    stage.addEventListener("wheel", release, true);
    stage.addEventListener("keydown", release, true);
    return () => {
      map.off("idle", idle);
      stage.removeEventListener("pointerdown", release, true);
      stage.removeEventListener("wheel", release, true);
      stage.removeEventListener("keydown", release, true);
    };
  }, [detailOpen, held, map, release]);

  useEffect(() => {
    // Clear the snapshot once the external map and its debounced rows agree.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (held && !detailOpen && returnIdle && viewSettled && current.key === held.key) release();
  }, [current.key, detailOpen, held, release, returnIdle, viewSettled]);

  return { displayed: held ?? current, release };
}
