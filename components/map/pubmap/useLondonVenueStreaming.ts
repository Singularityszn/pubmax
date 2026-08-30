"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type * as maplibregl from "maplibre-gl";

import { WIDER_VENUE_MIN_ZOOM } from "@/components/map/canvas/buildScene";
import { londonVenuesToGeoJSON } from "@/components/map/canvas/geojson";
import {
  createLondonVenueLoader,
  type LondonVenue,
  type LondonVenueLoader,
} from "@/lib/londonVenueShards";

const STREAM_DEBOUNCE_MS = 180;
const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

export type LondonVenueStreamState = {
  count: number;
  venues: LondonVenue[];
};

type PublishedLondonVenueStreamState = LondonVenueStreamState & {
  scopeKey: string;
};

const EMPTY_STREAM_STATE: LondonVenueStreamState = { count: 0, venues: [] };

export function visibleLondonVenueStreamState(
  published: PublishedLondonVenueStreamState,
  scopeKey: string,
  enabled: boolean,
): LondonVenueStreamState {
  if (!enabled || published.scopeKey !== scopeKey) return EMPTY_STREAM_STATE;
  return { count: published.count, venues: published.venues };
}

export function nextLondonVenueStreamToken(
  generation: { current: number },
  zoom: number,
  minZoom: number,
): number | null {
  const token = ++generation.current;
  return zoom < minZoom ? null : token;
}

export function invalidatePendingLondonVenueStream(
  generation: { current: number },
): void {
  generation.current += 1;
}

type Options = {
  mapRef: React.MutableRefObject<maplibregl.Map | null>;
  mapReady: boolean;
  applyToMap: (key: string, fn: (map: maplibregl.Map) => void) => void;
  widerVenuesDataRef: React.MutableRefObject<GeoJSON.FeatureCollection>;
  enabled: boolean;
  scopeKey: string;
};

export function useLondonVenueStreaming({
  mapRef,
  mapReady,
  applyToMap,
  widerVenuesDataRef,
  enabled,
  scopeKey,
}: Options): LondonVenueStreamState {
  const loaderRef = useRef<LondonVenueLoader | null>(null);
  const [published, setPublished] = useState<PublishedLondonVenueStreamState>(
    () => ({ scopeKey, count: 0, venues: [] }),
  );

  const publish = useCallback(
    (venues: LondonVenue[]) => {
      const data = venues.length > 0 ? londonVenuesToGeoJSON(venues) : EMPTY;
      widerVenuesDataRef.current = data;
      setPublished({ scopeKey, count: venues.length, venues });
      applyToMap("wider-venues:data", (map) => {
        (map.getSource("wider-venues") as maplibregl.GeoJSONSource | undefined)?.setData(data);
      });
    },
    [applyToMap, scopeKey, widerVenuesDataRef],
  );

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const generation = { current: 0 };

    const stream = () => {
      const current = mapRef.current;
      if (cancelled || !current) return;
      const token = nextLondonVenueStreamToken(
        generation,
        current.getZoom(),
        WIDER_VENUE_MIN_ZOOM,
      );
      if (!enabled || token === null) {
        if (widerVenuesDataRef.current.features.length > 0) publish([]);
        return;
      }
      if (!loaderRef.current) loaderRef.current = createLondonVenueLoader();
      const bounds = current.getBounds();
      void loaderRef.current
        .venuesForBounds({
          west: bounds.getWest(),
          south: bounds.getSouth(),
          east: bounds.getEast(),
          north: bounds.getNorth(),
        })
        .then((venues) => {
          if (cancelled || token !== generation.current) return;
          publish(venues);
        });
    };

    const schedule = () => {
      invalidatePendingLondonVenueStream(generation);
      if (timer) clearTimeout(timer);
      timer = setTimeout(stream, STREAM_DEBOUNCE_MS);
    };

    map.on("moveend", schedule);
    map.on("zoomend", schedule);
    schedule();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      map.off("moveend", schedule);
      map.off("zoomend", schedule);
    };
  }, [enabled, mapReady, mapRef, publish, widerVenuesDataRef]);

  return visibleLondonVenueStreamState(published, scopeKey, enabled);
}
