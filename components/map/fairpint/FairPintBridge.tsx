"use client";

import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import type { MapBounds } from "@/lib/slimShards";
import type { SlimVenue } from "@/lib/venuesSlim";
import type { NightAreaSlug } from "@/lib/nightAreas";
import type { MapReaderPosition } from "@/lib/mapReaderPosition";
import { MAP_FIRST_VISIT_ARRIVAL_CHANGE_EVENT } from "@/lib/mapFirstVisitArrivalGate";

export type Bridge = {
  bounds: MapBounds;
  center: [number, number];
  position?: MapReaderPosition | null;
  onCommit: (pounds: number) => void;
  onRoute: (area: NightAreaSlug | null, ids: string[], rows: SlimVenue[]) => void;
};
export const MapConnection = createContext<(value: Bridge | null) => void>(() => {});

export function FairPintMapBridge(props: Bridge) {
  const publish = useContext(MapConnection);
  const current = useRef(props);
  useLayoutEffect(() => {
    current.current = props;
  });
  const actions = useMemo(
    () => ({
      onCommit: (pounds: number) => current.current.onCommit(pounds),
      onRoute: (area: NightAreaSlug | null, ids: string[], rows: SlimVenue[]) =>
        current.current.onRoute(area, ids, rows),
    }),
    [],
  );
  const { west, south, east, north } = props.bounds;
  const [lng, lat] = props.center;
  useEffect(() => {
    publish({ bounds: { west, south, east, north }, center: [lng, lat], position: props.position ?? null, ...actions });
  }, [publish, actions, west, south, east, north, lng, lat, props.position]);
  useEffect(() => () => publish(null), [publish]);
  return null;
}

export function waitForFairPintRelease(): Promise<void> {
  const dragging = () => {
    const early = typeof window === "undefined" ? undefined : window.__pubmaxEarlyFairPint;
    return early?.dragging && !early.closed;
  };
  if (!dragging()) return Promise.resolve();
  return new Promise((resolve) => {
    const released = () => {
      if (dragging()) return;
      window.removeEventListener(MAP_FIRST_VISIT_ARRIVAL_CHANGE_EVENT, released);
      resolve();
    };
    window.addEventListener(MAP_FIRST_VISIT_ARRIVAL_CHANGE_EVENT, released);
  });
}
