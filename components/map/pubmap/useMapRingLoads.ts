"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

import type { CityId } from "@/lib/cities";
import {
  NEIGHBOUR_SHARD_RING,
  scheduleSlimShardRingLoads,
  VIEWPORT_SHARD_RING,
  type MapBounds,
  type SlimShardLoader,
} from "@/lib/slimShards";
import type { SlimVenue } from "@/lib/venuesSlim";

type RingLoadRefs = {
  slimLoaderRef: RefObject<SlimShardLoader | null>;
  slimLoaderGenerationRef: RefObject<number>;
  targetViewportLoadStartedRef: RefObject<boolean>;
  latestMapBoundsRef: RefObject<MapBounds | null>;
  latestMapBoundsCityRef: RefObject<CityId | null>;
  activeMapCityIdRef: RefObject<CityId>;
};

/**
 * The ring lane: the shards around the settled camera, streamed after the
 * opening shard. Until the pins have painted, the wire belongs to the pins
 * (lib/mapFirstPinStreams.ts). A ring asked for while the hold is on is
 * remembered rather than dropped, and runs against the camera the reader is
 * actually looking at once the hold ends.
 *
 * `viewShardsLanding` is true from the moment a view is asked for until its
 * own viewport ring has landed, or until the loader has said nothing more is
 * coming (`settleViewShards`). Until then the venues in view are a partial set.
 */
export function useMapRingLoads({
  secondaryStreamsHeld,
  refs,
  mergeSlimVenues,
  refreshCountCoverage,
}: {
  secondaryStreamsHeld: boolean;
  refs: RingLoadRefs;
  mergeSlimVenues: (rows: SlimVenue[]) => void;
  refreshCountCoverage: () => void;
}) {
  const {
    slimLoaderRef,
    slimLoaderGenerationRef,
    targetViewportLoadStartedRef,
    latestMapBoundsRef,
    latestMapBoundsCityRef,
    activeMapCityIdRef,
  } = refs;
  const secondaryStreamsHeldRef = useRef(true);
  const heldRingLoadRef = useRef<{
    loader: SlimShardLoader;
    bounds: MapBounds;
  } | null>(null);
  const [viewShardsLanding, setViewShardsLanding] = useState(true);
  const viewRequestRef = useRef(0);
  // Only the newest view request may say its view has landed.
  const awaitViewShards = useCallback(() => {
    const request = ++viewRequestRef.current;
    setViewShardsLanding(true);
    return () => {
      if (viewRequestRef.current === request) setViewShardsLanding(false);
    };
  }, []);
  const settleViewShards = useCallback(() => {
    viewRequestRef.current += 1;
    setViewShardsLanding(false);
  }, []);

  const scheduleRingLoad = useCallback(
    (
      loader: SlimShardLoader,
      bounds: MapBounds,
    ) => {
      if (secondaryStreamsHeldRef.current) {
        heldRingLoadRef.current = { loader, bounds };
        awaitViewShards();
        return;
      }
      const viewLanded = awaitViewShards();
      const loaderGeneration = slimLoaderGenerationRef.current;
      const isCurrentLoader = () =>
        slimLoaderRef.current === loader &&
        slimLoaderGenerationRef.current === loaderGeneration;
      const loadRing = (ring: number, onSettled?: () => void) => {
        if (!isCurrentLoader()) return;
        void loader
          .inBounds(bounds, ring)
          .then((rows) => {
            if (!isCurrentLoader()) return;
            mergeSlimVenues(rows);
            refreshCountCoverage();
          })
          .catch(() => undefined)
          .finally(() => onSettled?.());
      };
      scheduleSlimShardRingLoads(
        () => {
          if (!isCurrentLoader()) return;
          targetViewportLoadStartedRef.current = true;
          loadRing(VIEWPORT_SHARD_RING, viewLanded);
        },
        () => loadRing(NEIGHBOUR_SHARD_RING),
      );
    },
    [awaitViewShards, mergeSlimVenues, refreshCountCoverage, slimLoaderGenerationRef, slimLoaderRef, targetViewportLoadStartedRef],
  );

  useEffect(() => {
    secondaryStreamsHeldRef.current = secondaryStreamsHeld;
    if (secondaryStreamsHeld) return;
    const held = heldRingLoadRef.current;
    heldRingLoadRef.current = null;
    if (!held) return;
    // The camera may have settled somewhere else while the hold was on, so the
    // released ring reads the CURRENT view when the map has named one.
    const bounds =
      latestMapBoundsCityRef.current === activeMapCityIdRef.current &&
      latestMapBoundsRef.current
        ? latestMapBoundsRef.current
        : held.bounds;
    scheduleRingLoad(held.loader, bounds);
  }, [activeMapCityIdRef, latestMapBoundsCityRef, latestMapBoundsRef, scheduleRingLoad, secondaryStreamsHeld]);

  return { scheduleRingLoad, viewShardsLanding, awaitViewShards, settleViewShards };
}
