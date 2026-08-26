"use client";

import { useEffect, useState } from "react";

import type { CityId } from "@/lib/cities";
import {
  curatedCrawlsForCityAsync,
  landmarksForCityAsync,
  storyBandsForCityAsync,
} from "@/lib/cityStoryCatalog.async";
import type { CuratedCrawl } from "@/lib/curatedCrawls";
import type { Landmark } from "@/lib/landmarks";
import type { StoryBand } from "@/lib/storyBands";

export type CityStoryCatalog = {
  curatedCrawls: CuratedCrawl[];
  landmarks: Landmark[];
  storyBands: StoryBand[];
  ready: boolean;
};

const EMPTY_CATALOG: CityStoryCatalog = {
  curatedCrawls: [],
  landmarks: [],
  storyBands: [],
  ready: false,
};

/** Loads crawls, landmarks and story bands on demand per city. */
export function useCityStoryCatalog(
  cityId: CityId,
  enabled = true,
): CityStoryCatalog {
  const [catalog, setCatalog] = useState<CityStoryCatalog>(EMPTY_CATALOG);

  useEffect(() => {
    if (!enabled) {
      setCatalog(EMPTY_CATALOG);
      return;
    }
    // Drop the previous city's rows immediately so a London→Manchester switch
    // never paints London landmarks or crawl choices under Manchester state.
    setCatalog(EMPTY_CATALOG);
    let cancelled = false;
    void Promise.all([
      curatedCrawlsForCityAsync(cityId),
      landmarksForCityAsync(cityId),
      storyBandsForCityAsync(cityId),
    ]).then(([curatedCrawls, landmarks, storyBands]) => {
      if (cancelled) return;
      setCatalog({
        curatedCrawls,
        landmarks,
        storyBands,
        ready: true,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [cityId, enabled]);

  return catalog;
}
