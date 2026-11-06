// Regenerate the raw-name projection with:
// node --import tsx scripts/gen_ask_place_names.ts
// Keep source order and duplicates. The consumers own all normalisation.
import { realpathSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import stationZones from "../data/tfl_station_zones.json";
import { NIGHT_AREAS } from "../lib/nightAreas";
import localityGazetteer from "../public/data/london_localities.json";

export function generateAskPlaceNames() {
  return {
    stationNames: stationZones.stations.map((station) => station.name),
    localityNames: localityGazetteer.localities.map((locality) => locality.name),
    nightAreas: NIGHT_AREAS.map(({ name, aliases, transportAnchors }) => ({
      name,
      aliases,
      transportAnchors,
    })),
  };
}

const isDirectRun =
  typeof process.argv[1] === "string" &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));

if (isDirectRun) {
  writeFileSync(
    new URL("../lib/ask/placeNames.generated.json", import.meta.url),
    `${JSON.stringify(generateAskPlaceNames())}\n`,
  );
}
