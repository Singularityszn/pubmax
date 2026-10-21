import stationZones from "@/data/tfl_station_zones.json";
import { NIGHT_AREAS } from "@/lib/nightAreas";
import localityGazetteer from "@/public/data/london_localities.json";

/** Lower-case words only: "&" reads as "and", apostrophes drop, other marks split. */
export function wordsOnly(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['\u2019\u2018]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** Place names of two or more words: night areas, London localities, TfL stations. */
export const PLACE_PHRASES: readonly string[][] = [
  ...new Set(
    [
      ...NIGHT_AREAS.flatMap((area) => [area.name, ...area.aliases, ...area.transportAnchors]),
      ...localityGazetteer.localities.map((locality) => locality.name),
      ...stationZones.stations.map((station) => station.name),
    ].map(wordsOnly),
  ),
]
  .map((phrase) => phrase.split(" "))
  .filter((words) => words.length > 1);

export function isKnownAskPlacePhrase(value: string): boolean {
  const phrase = wordsOnly(value).replace(/^the\s+/, "");
  return PLACE_PHRASES.some((words) => words.join(" ") === phrase);
}
