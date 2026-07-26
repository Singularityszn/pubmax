"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type maplibregl from "maplibre-gl";

import { UK_BASE_MIN_ZOOM } from "@/components/map/canvas/buildScene";
import {
  createUkBaseLoader,
  ukBasePubsToGeoJSON,
  type UkBaseLoader,
  type UkBasePub,
} from "@/lib/ukBasePubs";

// Streams the UK base layer (lib/ukBasePubs.ts) into the map's `uk-base`
// source, one viewport at a time.
//
// The gate is the whole payload story: below UK_BASE_MIN_ZOOM this hook fetches
// NOTHING - not the shards, not even the manifest - so the London overview that
// most sessions never zoom past costs exactly what it cost before the layer
// existed. Crossing the gate fetches the manifest once and then only the cells
// the (padded) camera actually covers.
//
// Zooming back out empties the source rather than leaving thousands of hidden
// features parked in it: the layer's own `minzoom` would stop drawing them, but
// MapLibre would still hold and re-index them on every camera change.

/** Debounce for camera settle. Short enough to feel immediate after a pan. */
const STREAM_DEBOUNCE_MS = 180;

const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

type Options = {
  mapRef: React.MutableRefObject<maplibregl.Map | null>;
  mapReady: boolean;
  /** Style-load-safe mutation seam owned by PubMapCanvas. */
  applyToMap: (key: string, fn: (map: maplibregl.Map) => void) => void;
  /** Reseeded by buildScene after a theme setStyle wipes every source. */
  ukBaseDataRef: React.MutableRefObject<GeoJSON.FeatureCollection>;
  /**
   * A restored `?sel=venue-uk-*` arrival's id, one-shot: once a streamed
   * viewport contains it, the whole record is handed to `onRestorePub` (the id
   * alone carries no name/address/coords, so the sheet cannot open without
   * this resolution). Pending until found — a stale id from an old link
   * simply never resolves.
   */
  restoreId?: string | null;
  onRestorePub?: (pub: UkBasePub) => void;
};

/**
 * How many base pubs the current viewport is carrying. Published so the canvas
 * can expose it as a data attribute the same way it exposes the venue count -
 * the layer is otherwise invisible to any test that cannot reach the MapLibre
 * instance, and "the pins are there but too quiet to see" and "the pins never
 * loaded" look identical in a screenshot.
 */
export type UkBaseStreamState = { count: number };

export function useUkBaseStreaming({
  mapRef,
  mapReady,
  applyToMap,
  ukBaseDataRef,
  restoreId = null,
  onRestorePub,
}: Options): UkBaseStreamState {
  const loaderRef = useRef<UkBaseLoader | null>(null);
  const restoreIdRef = useRef<string | null>(restoreId);
  const onRestorePubRef = useRef(onRestorePub);
  useEffect(() => {
    onRestorePubRef.current = onRestorePub;
  }, [onRestorePub]);
  const [count, setCount] = useState(0);

  const publish = useCallback(
    (data: GeoJSON.FeatureCollection) => {
      ukBaseDataRef.current = data;
      setCount(data.features.length);
      applyToMap("uk-base:data", (map) => {
        (map.getSource("uk-base") as maplibregl.GeoJSONSource | undefined)?.setData(data);
      });
    },
    [applyToMap, ukBaseDataRef],
  );

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    // Monotonic token: a slow shard fetch that resolves after a later camera
    // move must not overwrite the newer viewport's pins.
    let generation = 0;

    const stream = () => {
      const current = mapRef.current;
      if (cancelled || !current) return;
      if (current.getZoom() < UK_BASE_MIN_ZOOM) {
        if (ukBaseDataRef.current.features.length > 0) publish(EMPTY);
        return;
      }
      if (!loaderRef.current) loaderRef.current = createUkBaseLoader();
      const token = ++generation;
      const bounds = current.getBounds();
      void loaderRef.current
        .pubsForBounds({
          west: bounds.getWest(),
          south: bounds.getSouth(),
          east: bounds.getEast(),
          north: bounds.getNorth(),
        })
        .then((pubs) => {
          if (cancelled || token !== generation) return;
          publish(ukBasePubsToGeoJSON(pubs));
          const wanted = restoreIdRef.current;
          if (!wanted) return;
          const hit = pubs.find((pub) => pub.id === wanted);
          if (!hit) return;
          restoreIdRef.current = null;
          onRestorePubRef.current?.(hit);
        });
    };

    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(stream, STREAM_DEBOUNCE_MS);
    };

    map.on("moveend", schedule);
    map.on("zoomend", schedule);
    // A restored session can open already past the gate, and no move follows.
    schedule();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      map.off("moveend", schedule);
      map.off("zoomend", schedule);
    };
  }, [mapReady, mapRef, publish, ukBaseDataRef]);

  return { count };
}
