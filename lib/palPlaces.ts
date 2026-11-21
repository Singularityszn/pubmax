import stationData from "@/data/tfl_station_zones.json";
import { landmarks } from "@/lib/landmarks";
import { NIGHT_PATCHES } from "@/lib/nightPatches";
import { normalizeSearchText } from "@/lib/textSlug";

export type PalPlace = { name: string; lat: number; lng: number; station: boolean };

const places: PalPlace[] = [
  ...stationData.stations.map(({ name, lat, lng }) => ({ name, lat, lng, station: true })),
  ...landmarks.map(({ name, coordinates: [lng, lat] }) => ({ name, lat, lng, station: false })),
  ...NIGHT_PATCHES.map(({ label: name, lat, lng }) => ({ name, lat, lng, station: false })),
];

export function palPlace(name: string): PalPlace | null {
  const key = normalizeSearchText(name).replace(/\s+(?:underground |tube |rail )?station$/, "");
  return places.find((place) => normalizeSearchText(place.name) === key) ?? null;
}

const placePatterns = places.map((place) => {
  const name = normalizeSearchText(place.name);
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return {
    place,
    pattern: new RegExp(`\\b(?:near|around|in|close to|at)\\s+(?:the\\s+)?${escaped}(?:\\s+(?:underground|tube|rail)?\\s*station)?(?=$|\\s+(?:for|with|tonight|today|tomorrow|this|on|at|under|over|please|and|friday|saturday|sunday|monday|tuesday|wednesday|thursday)\\b|[,.!?])`),
  };
});

export function palPlaceInQuery(query: string): PalPlace | null {
  const text = normalizeSearchText(query);
  let best: { place: PalPlace; index: number } | null = null;
  for (const { place, pattern } of placePatterns) {
    const match = pattern.exec(text);
    if (match && (!best || match.index < best.index || (match.index === best.index && place.name.length > best.place.name.length))) {
      best = { place, index: match.index };
    }
  }
  return best?.place ?? null;
}
