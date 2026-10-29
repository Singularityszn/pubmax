"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { useSearchParams } from "next/navigation";

import { mapArrivalFrame, searchParamsQuery } from "@/lib/pubMap";
import { parseMapAreaArrival } from "@/lib/mapAreaArrival";
import type { NightArea } from "@/lib/nightAreas";

export function useMapOpeningArrival(input: Omit<Parameters<typeof mapArrivalFrame>[0], "search">) {
  const routerParams = useSearchParams();
  const [arrival] = useState(() => {
    // The router destination can precede its browser-history commit. Snapshot
    // it once so the map's own later query writes do not become new arrivals.
    const query = searchParamsQuery(routerParams);
    const search = routerParams == null
      ? (typeof window === "undefined" ? "" : window.location.search)
      : (query ? `?${query}` : "");
    return {
      search,
      frame: mapArrivalFrame({ ...input, search }),
      area: parseMapAreaArrival(search, input.cityId),
    };
  });
  return arrival;
}

export function useNamedMapAreaArrival({ area, ready, readerActed, onSelect }: {
  area: NightArea | null;
  ready: boolean;
  readerActed: RefObject<boolean>;
  onSelect: (area: NightArea) => void;
}) {
  const spent = useRef(false);
  useEffect(() => {
    if (!area || spent.current) return;
    if (readerActed.current) {
      spent.current = true;
      return;
    }
    if (!ready) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled || spent.current) return;
      spent.current = true;
      if (readerActed.current) return;
      onSelect(area);
    });
    return () => { cancelled = true; };
  }, [area, ready, readerActed, onSelect]);
}
