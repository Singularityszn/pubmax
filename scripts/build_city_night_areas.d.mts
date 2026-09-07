import type { PlaceNode } from "./fetch_city_place_nodes.mjs";

export interface DerivedNightArea {
  slug: string;
  cityId: string;
  name: string;
  centre: { lat: number; lng: number };
  radiusKm: number;
  pubCount: number;
}

export interface BasePubPoint {
  osmId: string;
  name: string;
  lat: number;
  lng: number;
}

export const DERIVED_AREA_CITIES: readonly string[];
export const MAX_AREA_RADIUS_KM: number;
export const MIN_AREA_SEPARATION_KM: number;
export const MIN_AREA_PUBS: number;
export const MIN_AREAS_PER_CITY: number;
export const MAX_AREAS_PER_CITY: number;

export function haversineKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number;

export function placeKindRank(place: { kind: string }): number;

/** True for a base-layer row that states a pub. A bar row carries a seventh element. */
export function isBasePubRow(row: unknown): boolean;

export function nightAreaSlug(cityId: string, name: string): string;

export function deriveCityAreas(
  cityId: string,
  box: { latMin: number; lonMin: number; latMax: number; lonMax: number },
  allPubs: readonly BasePubPoint[],
  allPlaces: readonly PlaceNode[],
): DerivedNightArea[];
