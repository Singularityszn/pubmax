import stationData from "@/data/tfl_station_zones.json";
import { DAY_QUALIFIER, TIME_QUALIFIER } from "@/lib/ask/requestPolicy";
import { landmarks } from "@/lib/landmarks";
import { NIGHT_PATCHES } from "@/lib/nightPatches";
import { LONDON_BOROUGH_NAMES } from "@/lib/londonBoroughNames.mjs";
import { normalizeSearchText } from "@/lib/textSlug";

export type PalPlace = { name: string; lat: number; lng: number; station: boolean };

const places: PalPlace[] = [
  ...stationData.stations.map(({ name, lat, lng }) => ({ name, lat, lng, station: true })),
  ...landmarks.map(({ name, coordinates: [lng, lat] }) => ({ name, lat, lng, station: false })),
  ...NIGHT_PATCHES.map(({ label: name, lat, lng }) => ({ name, lat, lng, station: false })),
];

const areaNames = new Set([
  ...LONDON_BOROUGH_NAMES,
  ...NIGHT_PATCHES.map((patch) => patch.label),
].map(normalizeSearchText));

const qualifiers = [
  TIME_QUALIFIER,
  DAY_QUALIFIER,
  "for|with|tomorrow|this|in|on|at|under|over|below|max|maximum|up to|not|please|and|or|that|which|after|before|near|around|close to",
  "(?:friday|saturday|sunday|monday|tuesday|wednesday|thursday)(?:s|'s|’s)?",
  "january|february|march|april|may|june|july|august|september|october|november|december",
  "christmas|xmas|easter|halloween|valentine|new year|boxing day|bonfire night|year|eve|day|night|weekend|morning|afternoon|evening|midnight|nye",
].join("|");

const placePatterns = places.map((place) => {
  const name = normalizeSearchText(place.name);
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return {
    place,
    pattern: new RegExp(`\\b(near|around|in|close to|at)\\s+(?:the\\s+)?${escaped}(\\s+(?:(?:underground|tube|rail)\\s+)?station)?(?=$|\\s+(?:${qualifiers})\\b|\\s+(?:£\\s*\\d|\\d+(?:\\.\\d+)?\\s+(?:quid|pounds?)\\b)|[,.!?])`, "g"),
  };
});

export function palPlaceInQuery(query: string): PalPlace | null {
  const text = normalizeSearchText(query);
  let best: { place: PalPlace; index: number } | null = null;
  for (const { place, pattern } of placePatterns) {
    for (const match of text.matchAll(pattern)) {
      if (!match[2] && areaNames.has(normalizeSearchText(place.name)) && !/^(?:near|around|close to)$/.test(match[1] ?? "")) continue;
      if (!best || match.index < best.index || (match.index === best.index && place.name.length > best.place.name.length)) {
        best = { place, index: match.index };
      }
    }
  }
  return best?.place ?? null;
}
