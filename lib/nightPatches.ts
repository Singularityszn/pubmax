// Night patches: the areas Londoners actually SAY when they mean a night out —
// "Soho", "Brixton" — not the 32 administrative boroughs. The location-denied
// fallback used to open with an alphabetical borough wall ("Barking and
// Dagenham" first); now it answers immediately from a patch centre and offers
// these eight, nightlife-gravity ordered, with the full borough list demoted
// to an expander. Each patch is a coordinate the existing rankNearMe ranker
// answers from directly, so a patch answer carries real walk minutes from a
// spot everyone can picture (the Tube exit, give or take).
//
// Persistence mirrors lib/cityPreference.ts: localStorage-backed, SSR-safe,
// silent degradation, no-op writes skipped.

import { CITIES, pointInCityBounds } from "@/lib/cities";

export type NightPatch = {
  id: string;
  label: string;
  lat: number;
  lng: number;
};

// Nightlife-gravity order, not alphabetical. Coordinates are the patch's
// walking heart (station exit / high street), inside the priced-data footprint.
export const NIGHT_PATCHES = [
  { id: "soho", label: "Soho", lat: 51.5136, lng: -0.1365 },
  { id: "shoreditch", label: "Shoreditch", lat: 51.5265, lng: -0.0785 },
  { id: "camden", label: "Camden", lat: 51.539, lng: -0.1426 },
  { id: "london-bridge", label: "London Bridge", lat: 51.5049, lng: -0.0871 },
  { id: "brixton", label: "Brixton", lat: 51.4627, lng: -0.1145 },
  { id: "clapham", label: "Clapham", lat: 51.4622, lng: -0.1385 },
  { id: "islington", label: "Islington", lat: 51.5343, lng: -0.1055 },
  // Broadway Market / London Fields — Hackney's pub heart carries the priced
  // density; Hackney Central itself is thin in the index.
  { id: "hackney", label: "Hackney", lat: 51.5346, lng: -0.0611 },
] as const satisfies readonly NightPatch[];

/** Stable ids for the eight user-facing London night patches. */
export type NightPatchId = (typeof NIGHT_PATCHES)[number]["id"];

// The unpicked default: show central London's answer before asking anything.
// Centred between Soho and Covent Garden so the first cards read unmistakably
// "central" to a visitor and a local alike.
export const CENTRAL_PATCH: NightPatch = {
  id: "central",
  label: "central London",
  lat: 51.5129,
  lng: -0.13,
};

export function resolveNightPatch(id: string | null | undefined): NightPatch | null {
  if (!id) return null;
  if (id === CENTRAL_PATCH.id) return CENTRAL_PATCH;
  return NIGHT_PATCHES.find((patch) => patch.id === id) ?? null;
}

const EARTH_RADIUS_METRES = 6_371_000;

function toRadians(degrees: number): number {
  return degrees * Math.PI / 180;
}

function haversineMetres(latA: number, lngA: number, latB: number, lngB: number): number {
  const latDelta = toRadians(latB - latA);
  const lngDelta = toRadians(lngB - lngA);
  const startLat = toRadians(latA);
  const endLat = toRadians(latB);
  const chord = Math.sin(latDelta / 2) ** 2
    + Math.cos(startLat) * Math.cos(endLat) * Math.sin(lngDelta / 2) ** 2;
  return 2 * EARTH_RADIUS_METRES * Math.asin(Math.sqrt(chord));
}

/**
 * Resolve a usable London coordinate to the nearest supported night patch.
 * Invalid and out-of-city coordinates deliberately return null so callers do
 * not silently turn a failed location lookup into a misleading area choice.
 */
export function nearestNightPatch(
  lat: number,
  lng: number,
): (typeof NIGHT_PATCHES)[number] | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (!pointInCityBounds(lat, lng, CITIES.london)) return null;

  let nearest: (typeof NIGHT_PATCHES)[number] | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const patch of NIGHT_PATCHES) {
    const distance = haversineMetres(lat, lng, patch.lat, patch.lng);
    if (distance < nearestDistance) {
      nearest = patch;
      nearestDistance = distance;
    }
  }
  return nearest;
}

/** What the viewer last chose when location wasn't playing: a patch or a borough. */
export type RememberedArea =
  | { kind: "patch"; id: string }
  | { kind: "borough"; name: string };

const STORAGE_KEY = "pubmax:nightPatch:v1";

function hasStorage(): boolean {
  return typeof window !== "undefined" && !!window.localStorage;
}

function parseRemembered(raw: string | null): RememberedArea | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<RememberedArea> | null;
    if (!value || typeof value !== "object") return null;
    if (value.kind === "patch" && typeof value.id === "string" && resolveNightPatch(value.id)) {
      return { kind: "patch", id: value.id };
    }
    if (value.kind === "borough" && typeof value.name === "string" && value.name.trim()) {
      return { kind: "borough", name: value.name.trim() };
    }
    return null;
  } catch {
    return null;
  }
}

/** Last chosen area, or null on SSR / unset / unreadable / stale shape. */
export function readRememberedArea(): RememberedArea | null {
  if (!hasStorage()) return null;
  try {
    return parseRemembered(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
}

/** Persist the chosen area so the next locationless visit answers in one paint. */
export function writeRememberedArea(area: RememberedArea): void {
  if (!hasStorage()) return;
  const valid =
    area.kind === "patch" ? Boolean(resolveNightPatch(area.id)) : Boolean(area.name.trim());
  if (!valid) return;
  try {
    const next = JSON.stringify(area);
    if (window.localStorage.getItem(STORAGE_KEY) === next) return;
    window.localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Storage full / disabled / private mode — degrade silently.
  }
}

export function clearRememberedArea(): void {
  if (!hasStorage()) return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
