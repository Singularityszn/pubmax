"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type * as maplibregl from "maplibre-gl";

import { UK_BASE_MIN_ZOOM } from "@/components/map/canvas/buildScene";
import {
  createUkBaseLoader,
  isUkBaseId,
  ukBasePubsForDrawableVenues,
  ukBasePubsToGeoJSON,
  type UkBaseLoader,
  type UkBasePub,
} from "@/lib/ukBasePubs";
import { discardBody } from "@/lib/responseBody";

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
//
// Cold `?sel=venue-uk-*` restore does NOT wait for that viewport stream: it
// resolves the id via a hint-scoped shard fetch (or /api/uk-base/[id]) so a
// shared link can open the sheet before the cell paints.

/** Debounce for camera settle. Short enough to feel immediate after a pan. */
const STREAM_DEBOUNCE_MS = 180;

const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

export type UkBaseRestoreHint = { lat: number; lng: number } | null;

export type UkBaseRestoreFailure = "missing" | "unavailable";

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
   * A restored `?sel=venue-uk-*` arrival's id. Resolved cold (hint shard or
   * API) before the viewport stream; the stream path remains a fallback if the
   * cold path has not yet finished. Null when the arrival named no base pub.
   */
  restoreId?: string | null;
  /** Optional `at=` companion; scopes the cold shard fetch to one cell. */
  restoreHint?: UkBaseRestoreHint;
  onRestorePub?: (pub: UkBasePub) => void;
  /** Fail closed: id not in the pack, or the pack could not be read. */
  onRestoreFailed?: (reason: UkBaseRestoreFailure) => void;
};

/**
 * How many base pubs the current padded map source is carrying. Published so
 * the canvas can expose it as a data attribute the same way it exposes the
 * venue count. PubMapCanvas projects these source rows for exact visible-list
 * membership; keeping padding here lets that list update during a pan without
 * waiting for the next debounced shard fetch.
 */
export type UkBaseStreamStatus =
  | "zoom_required"
  | "loading"
  | "ready"
  | "unavailable"
  | "suspended";

type UkBasePubsState = { count: number; pubs: UkBasePub[] };
export type UkBaseStreamState = UkBasePubsState & {
  status: UkBaseStreamStatus;
};
type PublishedUkBaseStreamState = UkBaseStreamState & { scopeKey: string };

export function initialUkBaseStreamStatus(
  suspended: boolean,
): UkBaseStreamStatus {
  return suspended ? "suspended" : "loading";
}

const EMPTY_UK_BASE_PUBS_STATE: UkBasePubsState = {
  count: 0,
  pubs: [],
};

export function visibleUkBaseStreamState(
  published: UkBasePubsState & { scopeKey: string },
  scopeKey: string,
  suspended: boolean,
): UkBasePubsState {
  if (suspended || published.scopeKey !== scopeKey) {
    return EMPTY_UK_BASE_PUBS_STATE;
  }
  return { count: published.count, pubs: published.pubs };
}

export function nextUkBaseStreamToken(
  generation: { current: number },
  zoom: number,
  minZoom: number,
): number | null {
  const token = ++generation.current;
  return zoom < minZoom ? null : token;
}

export function isCurrentUkBaseStreamToken(
  generation: { current: number },
  token: number | null,
): boolean {
  return token !== null && token === generation.current;
}

/**
 * Parse `/api/uk-base/[id]` JSON. Pure so cold-restore tests do not need a
 * network. Rejects anything that is not a well-formed base pub.
 */
export function parseUkBaseRestoreResponse(
  value: unknown,
  expectedId: string,
): UkBasePub | null {
  if (typeof value !== "object" || value === null) return null;
  const pub = (value as { pub?: unknown }).pub;
  if (typeof pub !== "object" || pub === null) return null;
  const row = pub as Record<string, unknown>;
  if (typeof row.id !== "string" || row.id !== expectedId || !isUkBaseId(row.id)) {
    return null;
  }
  if (typeof row.name !== "string" || row.name.length === 0) return null;
  if (typeof row.lat !== "number" || !Number.isFinite(row.lat)) return null;
  if (typeof row.lng !== "number" || !Number.isFinite(row.lng)) return null;
  return {
    id: row.id,
    name: row.name,
    address: typeof row.address === "string" ? row.address : "",
    lat: row.lat,
    lng: row.lng,
    curatedVenueId:
      typeof row.curatedVenueId === "string" ? row.curatedVenueId : "",
  };
}

async function fetchUkBasePubById(id: string): Promise<{
  pub: UkBasePub | null;
  failure: UkBaseRestoreFailure | null;
}> {
  try {
    const response = await fetch(`/api/uk-base/${encodeURIComponent(id)}`);
    if (response.status === 404) {
      discardBody(response);
      return { pub: null, failure: "missing" };
    }
    if (response.status === 503) {
      discardBody(response);
      return { pub: null, failure: "unavailable" };
    }
    if (!response.ok) {
      discardBody(response);
      return { pub: null, failure: "unavailable" };
    }
    const pub = parseUkBaseRestoreResponse(await response.json(), id);
    return pub
      ? { pub, failure: null }
      : { pub: null, failure: "unavailable" };
  } catch {
    return { pub: null, failure: "unavailable" };
  }
}

/**
 * Cold resolve a restore id: hint-scoped shard first, then the server lookup.
 * Extracted for unit tests so the order (and fail-closed miss) is pinned.
 */
export async function resolveUkBaseRestorePub(
  loader: UkBaseLoader,
  id: string,
  hint: UkBaseRestoreHint,
  fetchById: typeof fetchUkBasePubById = fetchUkBasePubById,
): Promise<{ pub: UkBasePub | null; failure: UkBaseRestoreFailure | null }> {
  if (!isUkBaseId(id)) return { pub: null, failure: "missing" };
  const local = await loader.restorePub(id, hint);
  if (local) return { pub: local, failure: null };
  return fetchById(id);
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
  restoreHint = null,
  onRestorePub,
  onRestoreFailed,
}: Options): UkBaseStreamState {
  const loaderRef = useRef<UkBaseLoader | null>(null);
  const restoreIdRef = useRef<string | null>(restoreId);
  const restoreHintRef = useRef<UkBaseRestoreHint>(restoreHint);
  const onRestorePubRef = useRef(onRestorePub);
  const onRestoreFailedRef = useRef(onRestoreFailed);
  useEffect(() => {
    onRestorePubRef.current = onRestorePub;
  }, [onRestorePub]);
  useEffect(() => {
    onRestoreFailedRef.current = onRestoreFailed;
  }, [onRestoreFailed]);
  useEffect(() => {
    restoreHintRef.current = restoreHint;
  }, [restoreHint]);
  const [published, setPublished] = useState<PublishedUkBaseStreamState>(
    () => ({
      scopeKey,
      status: initialUkBaseStreamStatus(suspended),
      count: 0,
      pubs: [],
    }),
  );

  const publish = useCallback(
    (nextPubs: UkBasePub[], status: UkBaseStreamStatus) => {
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
        status,
        count: drawablePubs.length,
        // Keep the padded source rows available for immediate reprojection as
        // the camera moves. PubMapCanvas publishes only rows actually on the
        // rendered canvas, so stale AABB membership never reaches the DOM list
        // or provisional-mark reader while the next shard fetch is debounced.
        pubs: drawablePubs,
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

  const publishStatus = useCallback(
    (status: UkBaseStreamStatus) => {
      setPublished((current) => {
        if (current.scopeKey !== scopeKey) {
          return { scopeKey, status, count: 0, pubs: [] };
        }
        return current.status === status ? current : { ...current, status };
      });
    },
    [scopeKey],
  );

  // Cold restore: resolve the shared link before (and without) the viewport
  // stream. One-shot per restoreId; stream-path restore below is the fallback
  // only while this is still pending.
  useEffect(() => {
    const wanted = restoreId;
    if (!wanted || !isUkBaseId(wanted)) return;
    let cancelled = false;
    if (!loaderRef.current) loaderRef.current = createUkBaseLoader();
    void resolveUkBaseRestorePub(
      loaderRef.current,
      wanted,
      restoreHintRef.current,
    ).then(({ pub, failure }) => {
      if (cancelled) return;
      if (restoreIdRef.current !== wanted) return;
      if (pub) {
        restoreIdRef.current = null;
        onRestorePubRef.current?.(pub);
        return;
      }
      if (failure) {
        restoreIdRef.current = null;
        onRestoreFailedRef.current?.(failure);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [restoreId]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    // Monotonic token: a slow shard fetch that resolves after a later camera
    // move must not overwrite the newer viewport's pins.
    const generation = { current: 0 };

    const stream = (token: number | null) => {
      const current = mapRef.current;
      if (cancelled || !current) return;
      if (suspended) {
        if (ukBaseDataRef.current.features.length > 0) {
          publish([], "suspended");
        } else {
          publishStatus("suspended");
        }
        return;
      }
      if (token === null) {
        if (ukBaseDataRef.current.features.length > 0) {
          publish([], "zoom_required");
        } else {
          publishStatus("zoom_required");
        }
        return;
      }
      publishStatus("loading");
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
        .then((result) => {
          if (cancelled || !isCurrentUkBaseStreamToken(generation, token)) return;
          const drawablePubs = publish(result.pubs, result.status);
          const wanted = restoreIdRef.current;
          if (!wanted) return;
          const hit = drawablePubs.find((pub) => pub.id === wanted);
          if (!hit) return;
          restoreIdRef.current = null;
          onRestorePubRef.current?.(hit);
        })
        .catch(() => {
          if (cancelled || !isCurrentUkBaseStreamToken(generation, token)) return;
          publish([], "unavailable");
        });
    };

    const schedule = () => {
      if (timer) clearTimeout(timer);
      const current = mapRef.current;
      if (!current) return;
      const token = nextUkBaseStreamToken(
        generation,
        current.getZoom(),
        UK_BASE_MIN_ZOOM,
      );
      if (!suspended && token !== null) publishStatus("loading");
      timer = setTimeout(() => stream(token), STREAM_DEBOUNCE_MS);
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
  }, [mapReady, mapRef, publish, publishStatus, suspended, ukBaseDataRef]);

  // Suspension answers zero the moment it is set, ahead of the debounce that
  // empties the source, so the list beside the map never outlives the pins.
  const visible = visibleUkBaseStreamState(published, scopeKey, suspended);
  return {
    ...visible,
    status:
      suspended
        ? "suspended"
        : published.scopeKey === scopeKey
          ? published.status
          : "loading",
  };
}
