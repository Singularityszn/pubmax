"use client";

import { useEffect, useRef, type RefObject } from "react";
import {
  ARRIVAL_BEARING_POLL_MS,
  nextArrivalBearingWait,
  type ArrivalBearingWait,
} from "@/lib/mapArrivalBearing";

export function useMapArrivalTurn({
  mapRef, mapInstanceReady, mapError, deepLinked, sample, easeArrivalBearing,
}: {
  mapRef: RefObject<unknown>;
  mapInstanceReady: boolean;
  mapError: unknown;
  deepLinked: boolean;
  sample: () => { moving: boolean; pinsPending: boolean; openingPending: boolean };
  easeArrivalBearing: (deepLinked: boolean) => void;
}) {
  const spent = useRef(false);
  const arrivalDeepLink = useRef(deepLinked);
  useEffect(() => {
    if (!mapRef.current || spent.current) return;
    if (mapError) {
      spent.current = true;
      return;
    }
    let cancelled = false;
    let wait: ArrivalBearingWait | null = { stillPolls: 0, waitedMs: 0 };
    const tick = () => {
      if (cancelled || spent.current || !wait) return;
      wait = nextArrivalBearingWait(wait, sample());
      if (wait) {
        timer = setTimeout(tick, ARRIVAL_BEARING_POLL_MS);
        return;
      }
      spent.current = true;
      easeArrivalBearing(arrivalDeepLink.current);
    };
    let timer: ReturnType<typeof setTimeout> = setTimeout(tick, ARRIVAL_BEARING_POLL_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [mapRef, mapInstanceReady, mapError, sample, easeArrivalBearing]);
  return spent;
}
