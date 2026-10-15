"use client";

import { useEffect, useRef, useState } from "react";
import { startMapLoadTiming } from "@/lib/mapLoadTiming";

/**
 * Time this map visit for the field: one `map_load_timing` event when the
 * pins first paint, time out or the visit ends first. The clock starts at the
 * map's first render so marks set by child effects before this one still count.
 */
export function useMapLoadTiming(venueCount: number): void {
  const [mountMs] = useState(() =>
    typeof performance === "undefined" ? 0 : performance.now());
  const venueCountRef = useRef(venueCount);
  useEffect(() => {
    venueCountRef.current = venueCount;
  }, [venueCount]);
  useEffect(
    () => startMapLoadTiming({ mountMs, venueCount: () => venueCountRef.current }),
    [mountMs],
  );
}
