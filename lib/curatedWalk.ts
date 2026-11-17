import { WALK_KMH } from "@/lib/routeLegs";
import type { LngLat } from "@/lib/routeMiniMap";

export type MapRouteStop = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  mapLabel?: string;
};

export type CuratedWalk = {
  kicker: string;
  description: string;
  bestTime: string;
  mapActionLabel: string;
  accessNotes: string[];
  stops: (MapRouteStop & { source: string; note: string })[];
  path: LngLat[];
  source: string;
  observedOn: string;
  credit: string;
  distanceKm: number;
};

export function curatedWalkKm(walk: CuratedWalk): number {
  return walk.distanceKm;
}

export function curatedWalkLine(walk: CuratedWalk): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: [{ type: "Feature", properties: { source: "curated" },
      geometry: { type: "LineString", coordinates: walk.path } }],
  };
}

export function curatedPlannerTitle(crawl: { name: string; walk?: CuratedWalk } | null): string {
  return crawl?.walk ? crawl.name : "Plan an outing";
}

export function curatedWalkMinutes(walk: CuratedWalk): number {
  return Math.ceil(walk.distanceKm / WALK_KMH * 60);
}

export function curatedWalkSheetProps(walk: CuratedWalk | undefined, open: boolean, selectionToken: number) {
  return walk && open ? { surface: "solid" as const, mapInteractive: true, kicker: walk.kicker,
    requestedSnap: "half" as const, venueRevealSettleSequence: selectionToken } : {};
}
