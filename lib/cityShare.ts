// City map share / OG helpers — pure URL + copy for `/map` and `/map/[city]`
// deep links (including cult Place-story bands like Subcrawl / Freshers).

import {
  getCity,
  parseCityId,
  type CityId,
  DEFAULT_CITY_ID,
} from "@/lib/cities";
import { bandByIdForCity } from "@/lib/cityStoryBands";

/** Cult / viral Place-story band ids called out in the multi-city PRD. */
export const CULT_STORY_BAND_IDS = [
  "subcrawl",
  "freshers-first-night",
  "king-street-run",
  "bailey-crawl",
  "match-day-anfield",
  "harbourside",
] as const;

export type CultStoryBandId = (typeof CULT_STORY_BAND_IDS)[number];

export type CityMapShareOptions = {
  band?: string | null;
};

function resolveCityId(cityId: CityId | string | null | undefined): CityId {
  return parseCityId(cityId) ?? DEFAULT_CITY_ID;
}

function normalizeBandId(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  const id = raw.trim().toLowerCase();
  return id || undefined;
}

/** First string value from Next `searchParams` (string | string[] | undefined). */
export function firstSearchParam(
  value: string | string[] | undefined,
): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

/**
 * Canonical share path for a city map. London stays `/map` for back-compat;
 * other cities use `/map/{id}`. Optional `band` becomes `?band=…` when set.
 */
export function cityMapShareUrl(
  cityId: CityId | string | null | undefined,
  options: CityMapShareOptions = {},
): string {
  const id = resolveCityId(cityId);
  const path = id === "london" ? "/map" : `/map/${id}`;
  const band = normalizeBandId(options.band ?? undefined);
  if (!band) return path;
  const params = new URLSearchParams();
  params.set("band", band);
  return `${path}?${params.toString()}`;
}

/**
 * OG / document title for a city map. When `band` resolves for that city,
 * leads with the corridor title; otherwise city display name + short map label.
 * Layout template appends `| PUBMAXXING`.
 */
export function cityMapOgTitle(
  cityId: CityId | string | null | undefined,
  options: CityMapShareOptions = {},
): string {
  const id = resolveCityId(cityId);
  const city = getCity(id);
  const bandId = normalizeBandId(options.band ?? undefined);
  const band = bandId ? bandByIdForCity(id, bandId) : undefined;
  if (band) return `${band.title} — ${city.displayName}`;
  return `${city.displayName} pub map`;
}

/**
 * OG / meta description. Prefer band blurb when the band resolves; else city tagline.
 */
export function cityMapOgDescription(
  cityId: CityId | string | null | undefined,
  options: CityMapShareOptions = {},
): string {
  const id = resolveCityId(cityId);
  const city = getCity(id);
  const bandId = normalizeBandId(options.band ?? undefined);
  const band = bandId ? bandByIdForCity(id, bandId) : undefined;
  if (band) {
    const blurb = band.copy.trim().replace(/\s+/g, " ");
    // Keep social previews snappy; full copy lives on the map chip.
    if (blurb.length <= 200) return blurb;
    const cut = blurb.slice(0, 199);
    const lastSpace = cut.lastIndexOf(" ");
    const base = lastSpace > 80 ? cut.slice(0, lastSpace) : cut;
    return `${base.replace(/[.,;:\s]+$/u, "")}…`;
  }
  return `${city.tagline}. Plan a crawl on PUBMAXXING.`;
}

/**
 * Dynamic OG image URL. Query-aware so crawlers that hit `?band=` get a cult
 * card (opengraph-image.tsx cannot read searchParams).
 */
export function cityMapOgImageUrl(
  cityId: CityId | string | null | undefined,
  options: CityMapShareOptions = {},
): string {
  const id = resolveCityId(cityId);
  const params = new URLSearchParams();
  params.set("city", id);
  const band = normalizeBandId(options.band ?? undefined);
  if (band) params.set("band", band);
  return `/api/city-map-card?${params.toString()}`;
}

export function cityMapOgAlt(
  cityId: CityId | string | null | undefined,
  options: CityMapShareOptions = {},
): string {
  return `${cityMapOgTitle(cityId, options)} — PUBMAXXING`;
}
