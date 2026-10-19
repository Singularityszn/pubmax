/** A legacy OSM row retains the amenity recorded beside its exact source ID. */
export function legacyOsmVenueKind(rows) {
  for (const row of rows) {
    const id = /(?:^|\|)osm_overpass\|((?:node|way|relation)\/\d+)(?:\||$)/.exec(String(row.data_quality_notes ?? ""))?.[1];
    if (!id) continue;
    const observation = /OpenStreetMap (pub|bar) ((?:node|way|relation)\/\d+)(?:;|\s|$)/.exec(String(row.comment ?? ""));
    if (observation?.[2] === id && observation[1] === "bar") return "bar";
  }
  return undefined;
}
