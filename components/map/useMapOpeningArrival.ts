"use client";

import { useEffect, useRef, useState, type RefObject } from "react";

import { mapArrivalFrame } from "@/lib/pubMap";
import { parseMapAreaArrival } from "@/lib/mapAreaArrival";
import type { NightArea } from "@/lib/nightAreas";

export function useMapOpeningArrival(input: Omit<Parameters<typeof mapArrivalFrame>[0], "search">) {
  const [arrival] = useState(() => {
    const search = typeof window === "undefined" ? "" : window.location.search;
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
