"use client";

import { useEffect, useLayoutEffect, useState } from "react";

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
  cityId: CityId | null;
  curatedCrawls: CuratedCrawl[];
  landmarks: Landmark[];
  storyBands: StoryBand[];
  ready: boolean;
  degraded: boolean;
};

function emptyCatalog(cityId: CityId | null = null): CityStoryCatalog {
  return {
    cityId,
    curatedCrawls: [],
    landmarks: [],
    storyBands: [],
    ready: false,
    degraded: false,
  };
}

/** Loads crawls, landmarks and story bands on demand per city. */
export function useCityStoryCatalog(
  cityId: CityId,
  enabled = true,
): CityStoryCatalog {
  const [catalog, setCatalog] = useState<CityStoryCatalog>(() => emptyCatalog(cityId));

  useLayoutEffect(() => {
    if (!enabled) {
      setCatalog(emptyCatalog(null));
      return;
    }
    setCatalog(emptyCatalog(cityId));
  }, [cityId, enabled]);

  useEffect(() => {
    if (!enabled) return;
    const requestedCity = cityId;
    let cancelled = false;
    void Promise.all([
      curatedCrawlsForCityAsync(requestedCity),
      landmarksForCityAsync(requestedCity),
      storyBandsForCityAsync(requestedCity),
    ])
      .then(([curatedCrawls, landmarks, storyBands]) => {
        if (cancelled) return;
        setCatalog({
          cityId: requestedCity,
          curatedCrawls,
          landmarks,
          storyBands,
          ready: true,
          degraded: false,
        });
      })
      .catch(() => {
        if (cancelled) return;
        setCatalog({
          cityId: requestedCity,
          curatedCrawls: [],
          landmarks: [],
          storyBands: [],
          ready: true,
          degraded: true,
        });
      });
    return () => {
      cancelled = true;
    };
  }, [cityId, enabled]);

  if (!enabled || catalog.cityId !== cityId) {
    return emptyCatalog(cityId);
  }
  return catalog;
}
