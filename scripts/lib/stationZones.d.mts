// Hand-written types for the plain-JS nearest-station zone module (allowJs is
// off, so tsc needs a declaration to typecheck the unit tests that import it).
// Keep in lockstep with scripts/lib/stationZones.mjs.

import type { StationZone } from "../../lib/nearestStationZone.mjs";

export type { NearestStationZone, StationZone } from "../../lib/nearestStationZone.mjs";
export { nearestStationZone } from "../../lib/nearestStationZone.mjs";

export function haversineKm(
  latA: number,
  lngA: number,
  latB: number,
  lngB: number,
): number;

export function loadStationZones(): Promise<StationZone[]>;
