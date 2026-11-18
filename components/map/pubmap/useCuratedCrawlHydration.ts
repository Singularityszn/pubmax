"use client";

import { useLayoutEffect, useRef, useState } from "react";

import type { CityId } from "@/lib/cities";
import type { CuratedCrawlHydration, CuratedCrawlHydrationSnapshot } from "@/lib/mapSeedCrawl";
import { mapSeedNeedsCuratedCrawlLookup } from "@/lib/mapSeedCrawlPolicy";
import type { WalkRequest } from "./useMapPlanCoordinator";

export function useCuratedCrawlHydration({
  arrivalSearch, cityId, seed, walkRequest, snapshot, onHydrate,
}: {
  arrivalSearch: string;
  cityId: CityId;
  seed: CuratedCrawlHydrationSnapshot;
  walkRequest: WalkRequest;
  snapshot: CuratedCrawlHydrationSnapshot;
  onHydrate: (hydration: CuratedCrawlHydration) => void;
}) {
  const snapshotRef = useRef(snapshot);
  useLayoutEffect(() => { snapshotRef.current = snapshot; });
  const search = walkRequest.search ?? arrivalSearch;
  const [settledRequest, setSettledRequest] = useState<WalkRequest | null>(null);
  useLayoutEffect(() => {
    if (!mapSeedNeedsCuratedCrawlLookup(search)) return;
    let cancelled = false;
    const expected = walkRequest.count === 0 ? seed : snapshotRef.current;
    void import("@/lib/mapSeedCrawl")
      .then(async ({ curatedCrawlHydrationFromSeed, sameCuratedCrawlHydrationSnapshot }) => {
        if (cancelled) return;
        const hydration = await curatedCrawlHydrationFromSeed(search, cityId);
        if (cancelled) return;
        if (hydration && sameCuratedCrawlHydrationSnapshot(expected, snapshotRef.current)) onHydrate(hydration);
        setSettledRequest(walkRequest);
      })
      .catch(() => { if (!cancelled) setSettledRequest(walkRequest); });
    return () => { cancelled = true; };
  }, [cityId, onHydrate, search, seed, walkRequest]);
  return mapSeedNeedsCuratedCrawlLookup(search) && settledRequest !== walkRequest;
}
