import corrections from "../data/venue_kind_corrections.json" with { type: "json" };

function normalised(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

/** The identity a reviewed kind correction names: the source row's own name and address. */
export function venueKindCorrectionKey(name, address) {
  return `${normalised(name)}|${normalised(address)}`;
}

const CORRECTED_KINDS = new Map(
  corrections.map((entry) => [venueKindCorrectionKey(entry.name, entry.address), entry.kind]),
);

/**
 * A curated London row is a bar when a reviewed correction in
 * data/venue_kind_corrections.json names its exact name and address, or when
 * its legacy OSM row retains the amenity recorded beside its exact source ID.
 * Any other row is a pub.
 */
export function legacyOsmVenueKind(rows) {
  for (const row of rows) {
    const corrected = CORRECTED_KINDS.get(venueKindCorrectionKey(row.pub_name, row.address));
    if (corrected) return corrected;
  }
  for (const row of rows) {
    const id = /(?:^|\|)osm_overpass\|((?:node|way|relation)\/\d+)(?:\||$)/.exec(String(row.data_quality_notes ?? ""))?.[1];
    if (!id) continue;
    const observation = /OpenStreetMap (pub|bar) ((?:node|way|relation)\/\d+)(?:;|\s|$)/.exec(String(row.comment ?? ""));
    if (observation?.[2] === id && observation[1] === "bar") return "bar";
  }
  return undefined;
}
