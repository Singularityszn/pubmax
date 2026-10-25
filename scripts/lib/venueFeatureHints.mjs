import { canonicalOsmId } from "../../lib/harvestFold.ts";
import { outerLondonOwnerForPub } from "../../lib/outerLondonOwnership.mjs";

const positiveOutdoor = new Set(["yes", "garden", "sidewalk", "pavement", "terrace"]);
const validDate = (value) => typeof value === "string" && Number.isFinite(Date.parse(value)) && Date.parse(value) <= Date.now();

/** Mirrors the existing detail identity join. Ambiguous identities state no feature. */
export function buildVenueFeatureHints(venues, pubs, facts, places, siteFacts = []) {
  const ids = new Set(venues.map((venue) => venue.id));
  const osmIdsByVenue = new Map();
  for (const pub of pubs) {
    const id = pub.curatedRef?.source === "curated-london-slim" ? pub.curatedRef.id
      : pub.curatedRef?.source === "outer-london-osm-seed" ? outerLondonOwnerForPub(pub, venues) : null;
    const key = canonicalOsmId(pub.osmId ?? "");
    if (!ids.has(id) || !key) continue;
    const keys = osmIdsByVenue.get(id) ?? new Set();
    keys.add(key);
    osmIdsByVenue.set(id, keys);
  }
  const factsById = new Map(facts.map((row) => [canonicalOsmId(row.osmId ?? ""), row]));
  const placesById = new Map();
  for (const row of places) {
    const key = canonicalOsmId(row.venueId ?? "");
    if (!key) continue;
    const rows = placesById.get(key) ?? [];
    rows.push(row);
    placesById.set(key, rows);
  }
  const result = new Map();
  for (const [id, keys] of osmIdsByVenue) {
    const feature = {};
    const stated = [...keys].flatMap((key) => factsById.get(key) ?? []);
    if (stated.length === 1) {
      const row = stated[0];
      const observedAt = validDate(row.checkDate) ? row.checkDate : row.readOn;
      if (validDate(observedAt)) {
        if (["yes", "no"].includes(row.liveSport)) feature.liveSportsSource = [row.liveSport === "yes", "OpenStreetMap", observedAt];
        if (["yes", "leashed", "no", "outside"].includes(row.dog)) feature.dogsWelcome = [["yes", "leashed"].includes(row.dog), "OpenStreetMap", observedAt];
        if (row.beerGarden === "yes") feature.beerGarden = [true, "OpenStreetMap", observedAt];
        if (positiveOutdoor.has(row.outdoorSeating) || row.outdoorSeating === "no") feature.outdoorSeating = [positiveOutdoor.has(row.outdoorSeating), "OpenStreetMap", observedAt];
      }
    }
    const matches = [...keys].flatMap((key) => placesById.get(key) ?? []);
    if (new Set(matches.map((row) => row.googlePlaceId)).size === 1) {
      const observation = matches.map((row) => row.outdoorSeating)
        .filter((row) => row?.source === "google_places" && typeof row.value === "boolean" && validDate(row.observedAt))
        .sort((a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt))[0];
      if (observation) feature.outdoorSeating = [observation.value, "Google Places", observation.observedAt];
    }
    if (Object.keys(feature).length) result.set(id, feature);
  }
  addSiteDogHints(result, ids, siteFacts);
  return result;
}

function addSiteDogHints(result, ids, siteFacts) {
  for (const row of siteFacts) {
    if (!ids.has(row.venueId) || !validDate(row.readOn) || !/^https?:\/\//.test(row.sourceUrl ?? "")
      || !row.dogs?.evidence?.trim() || !["welcome", "not-allowed"].includes(row.dogs?.policy)) continue;
    const feature = result.get(row.venueId) ?? {};
    const previous = feature.dogsWelcome;
    if (!previous || Date.parse(row.readOn) >= Date.parse(previous[2])) {
      feature.dogsWelcome = [row.dogs.policy === "welcome", "Pub website", row.readOn];
    }
    result.set(row.venueId, feature);
  }
}
