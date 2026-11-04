// Regenerate the raw-name projection with:
// node --import tsx scripts/gen_ask_place_names.ts
// Keep source order and duplicates. The consumers own all normalisation.
import { writeFileSync } from "node:fs";

import stationZones from "../data/tfl_station_zones.json";
import { NIGHT_AREAS } from "../lib/nightAreas";
import localityGazetteer from "../public/data/london_localities.json";

const projection = {
  stationNames: stationZones.stations.map((station) => station.name),
  localityNames: localityGazetteer.localities.map((locality) => locality.name),
  nightAreas: NIGHT_AREAS.map(({ name, aliases, transportAnchors }) => ({
    name,
    aliases,
    transportAnchors,
  })),
};

writeFileSync(
  new URL("../lib/ask/placeNames.generated.json", import.meta.url),
  `${JSON.stringify(projection)}\n`,
);
