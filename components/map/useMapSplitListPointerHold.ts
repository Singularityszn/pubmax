import { useCallback, useEffect, useState } from "react";

import { MAP_SPLIT_LIST_DEBOUNCE_MS, type MapSplitListGroups } from "@/lib/mapSplitList";

export type MapSplitListPointerView = {
  groups: MapSplitListGroups;
  key: string;
  order: string;
  coverageNote: string | null;
  heldIsStale: boolean;
};

export function useMapSplitListPointerHold({
  current,
  pointerInside,
  loaded,
}: {
  current: MapSplitListPointerView;
  pointerInside: boolean;
  loaded: boolean;
}) {
  // Hold rendered rows during pointer interaction, except for explicit list actions.
  const [held, setHeld] = useState<MapSplitListPointerView | null>(null);
  if (!loaded && held !== null) setHeld(null);
  if (pointerInside && loaded && held === null && current.groups.total > 0) {
    setHeld(current);
  }
  useEffect(() => {
    if (pointerInside || held === null) return;
    const timer = setTimeout(() => setHeld(null), MAP_SPLIT_LIST_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [pointerInside, held]);
  const release = useCallback(() => setHeld(null), []);
  return { displayed: held ?? current, release };
}
