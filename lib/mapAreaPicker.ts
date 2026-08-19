// Choose-area sheet models — London neighbourhoods with live pub counts and
// search filtering over night areas + locality gazetteer rows.

import type { CityId } from "@/lib/cities";
import { listEnabledCities } from "@/lib/cities";
import type { Locality } from "@/lib/localities";
import { getNightAreasForCity } from "@/lib/nightAreas";
import { assignVenueToNightArea } from "@/lib/pricedLanding";
import type { Venue } from "@/lib/venues";

export type ChooseAreaNeighbourhood = {
  slug: string;
  name: string;
  pubCount: number;
  center: [number, number];
};

export type ChooseAreaCityRow = {
  cityId: CityId;
  name: string;
};

function normaliseQuery(query: string): string {
  return query.trim().toLowerCase();
}

/** One row, one visible name: the only thing a reader can tell two rows by. */
function rowIdentity(name: string): string {
  return name.trim().toLowerCase();
}

/** Count pubs per modelled night area for one city pack. */
export function londonNeighbourhoodRows(
  venues: readonly Venue[],
  cityId: CityId = "london",
): ChooseAreaNeighbourhood[] {
  const areas = getNightAreasForCity(cityId);
  const counts = new Map<string, number>();
  for (const venue of venues) {
    const area = assignVenueToNightArea(venue, areas);
    if (!area) continue;
    counts.set(area.slug, (counts.get(area.slug) ?? 0) + 1);
  }
  return areas
    .map((area) => ({
      slug: area.slug,
      name: area.name,
      pubCount: counts.get(area.slug) ?? 0,
      center: [area.centre.lng, area.centre.lat] as [number, number],
    }))
    .toSorted((a, b) => b.pubCount - a.pubCount || a.name.localeCompare(b.name));
}

export function filterChooseAreaNeighbourhoods(
  rows: readonly ChooseAreaNeighbourhood[],
  query: string,
  localities: readonly Locality[] = [],
): ChooseAreaNeighbourhood[] {
  const needle = normaliseQuery(query);
  if (!needle) return [...rows];

  const areaHits = rows.filter((row) => row.name.toLowerCase().includes(needle));
  // Deduped on the NAME, not the slug: every locality row carries a
  // `locality:` prefix of its own, so a slug comparison can never match and a
  // gazetteer entry sharing a night area's name would print twice with
  // identical visible text.
  const seen = new Set(areaHits.map((row) => rowIdentity(row.name)));

  const localityHits: ChooseAreaNeighbourhood[] = [];
  for (const locality of localities) {
    const haystack = `${locality.name} ${locality.borough}`.toLowerCase();
    if (!haystack.includes(needle)) continue;
    localityHits.push({
      slug: `locality:${locality.name.toLowerCase().replace(/\s+/g, "-")}`,
      name: locality.name,
      pubCount: 0,
      center: [locality.lng, locality.lat],
    });
  }

  const merged = [...areaHits];
  for (const row of localityHits) {
    const identity = rowIdentity(row.name);
    if (seen.has(identity)) continue;
    seen.add(identity);
    merged.push(row);
  }
  return merged;
}

/** Other enabled cities for the sheet footer, excluding the active one. */
export function otherCityRows(activeCityId: CityId): ChooseAreaCityRow[] {
  return listEnabledCities()
    .filter((city) => city.id !== activeCityId)
    .map((city) => ({ cityId: city.id, name: city.displayName }));
}
