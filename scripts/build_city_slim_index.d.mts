import type { CityDef } from "./fetch_city_osm_pubs.mjs";
export function cityVenueIdForPub(city: CityDef, pub: { name: string; address?: string; lat: number; lng: number }): string;
export function areaLabelForPub(pub: { locality?: string }, displayName: string): string;
export function buildCitySlim(city: CityDef, pack: { pubs: Array<{ name: string; address?: string; lat: number; lng: number; kind?: string }> }): { slim: Array<{ id: string; name: string; lat: number; lng: number; kind?: string; cheapestPrice: null; filterHints: { amenities: { food: boolean } } }>; droppedOob: number; droppedDup: number };
