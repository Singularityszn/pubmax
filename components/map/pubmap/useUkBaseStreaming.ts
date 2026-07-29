"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type * as maplibregl from "maplibre-gl";

import { UK_BASE_MIN_ZOOM } from "@/components/map/canvas/buildScene";
import {
  createUkBaseLoader,
  ukBasePubsForDrawableVenues,
  ukBasePubsToGeoJSON,
  type UkBaseLoader,
  type UkBasePub,
} from "@/lib/ukBasePubs";
import { pointInMapBounds, type MapBounds } from "@/lib/slimShards";

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
  drawableVenueIds: ReadonlySet<string>;
  /** Visibility-only marks keyed by stable `venue-uk-*` ids. */
  provisionalVenueIds?: ReadonlySet<string> | null;
  /**
   * An experience view owns the map. The base layer is UK-wide unpriced pubs,
   * so it answers neither "where can I drink without alcohol" nor "where can I
   * eat" - leaving it on would drown the curated set the view narrowed to.
   * Suspended behaves exactly like being below the zoom gate: the source is
   * emptied and nothing is fetched, so the view costs no payload either.
   */
  suspended?: boolean;
  scopeKey?: string;
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
export type UkBaseStreamState = { count: number; pubs: UkBasePub[] };
type PublishedUkBaseStreamState = UkBaseStreamState & { scopeKey: string };

const EMPTY_UK_BASE_STREAM_STATE: UkBaseStreamState = {
  count: 0,
  pubs: [],
};

export function visibleUkBaseStreamState(
  published: PublishedUkBaseStreamState,
  scopeKey: string,
  suspended: boolean,
): UkBaseStreamState {
  if (suspended || published.scopeKey !== scopeKey) {
    return EMPTY_UK_BASE_STREAM_STATE;
  }
  return { count: published.count, pubs: published.pubs };
}

export function ukBasePubsWithinBounds(
  pubs: UkBasePub[],
  bounds: MapBounds,
): UkBasePub[] {
  return pubs.filter((pub) => pointInMapBounds(pub.lat, pub.lng, bounds));
}

export function nextUkBaseStreamToken(
  generation: { current: number },
  zoom: number,
  minZoom: number,
): number | null {
  const token = ++generation.current;
  return zoom < minZoom ? null : token;
}

export function useUkBaseStreaming({
  mapRef,
  mapReady,
  applyToMap,
  ukBaseDataRef,
  drawableVenueIds,
  provisionalVenueIds = null,
  suspended = false,
  scopeKey = "",
  restoreId = null,
  onRestorePub,
}: Options): UkBaseStreamState {
  const loaderRef = useRef<UkBaseLoader | null>(null);
  const restoreIdRef = useRef<string | null>(restoreId);
  const onRestorePubRef = useRef(onRestorePub);
  useEffect(() => {
    onRestorePubRef.current = onRestorePub;
  }, [onRestorePub]);
  const [published, setPublished] = useState<PublishedUkBaseStreamState>(
    () => ({ scopeKey, count: 0, pubs: [] }),
  );

  const publish = useCallback(
    (nextPubs: UkBasePub[], viewportBounds?: MapBounds) => {
      const drawablePubs = ukBasePubsForDrawableVenues(
        nextPubs,
        drawableVenueIds,
      );
      const data =
        drawablePubs.length > 0
          ? ukBasePubsToGeoJSON(drawablePubs, provisionalVenueIds)
          : EMPTY;
      ukBaseDataRef.current = data;
      setPublished({
        scopeKey,
        count: drawablePubs.length,
        pubs: viewportBounds
          ? ukBasePubsWithinBounds(drawablePubs, viewportBounds)
          : [],
      });
      applyToMap("uk-base:data", (map) => {
        (map.getSource("uk-base") as maplibregl.GeoJSONSource | undefined)?.setData(data);
      });
      return drawablePubs;
    },
    [
      applyToMap,
      drawableVenueIds,
      provisionalVenueIds,
      scopeKey,
      ukBaseDataRef,
    ],
  );

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    // Monotonic token: a slow shard fetch that resolves after a later camera
    // move must not overwrite the newer viewport's pins.
    const generation = { current: 0 };

    const stream = () => {
      const current = mapRef.current;
      if (cancelled || !current) return;
      const token = nextUkBaseStreamToken(
        generation,
        current.getZoom(),
        UK_BASE_MIN_ZOOM,
      );
      if (token === null || suspended) {
        if (ukBaseDataRef.current.features.length > 0) publish([]);
        return;
      }
      if (!loaderRef.current) loaderRef.current = createUkBaseLoader();
      const bounds = current.getBounds();
      const viewportBounds = {
        west: bounds.getWest(),
        south: bounds.getSouth(),
        east: bounds.getEast(),
        north: bounds.getNorth(),
      };
      void loaderRef.current
        .pubsForBounds(viewportBounds)
        .then((pubs) => {
          if (cancelled || token !== generation.current) return;
          const drawablePubs = publish(pubs, viewportBounds);
          const wanted = restoreIdRef.current;
          if (!wanted) return;
          const hit = drawablePubs.find((pub) => pub.id === wanted);
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
  }, [mapReady, mapRef, publish, suspended, ukBaseDataRef]);

  // Suspension answers zero the moment it is set, ahead of the debounce that
  // empties the source, so the list beside the map never outlives the pins.
  return visibleUkBaseStreamState(published, scopeKey, suspended);
}
