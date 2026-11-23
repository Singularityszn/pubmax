// The name a curated London venue shows, cleaned of the web page title it was
// collected with ("The Abbey Tavern Pub | Kentish Town", "Slug & Lettuce -
// Croydon", "Ship Tavern, London").
//
// Only the shown name changes. A venue id hashes the dataset's own name
// (lib/venues.ts#venueGroupingKey), so the raw name stays on the row and rides
// beside the clean one as `sourceName` for search and name-keyed joins.
// scripts/build_slim_index.mjs writes the clean name, lib/venues.ts shows the
// same name on the detail path, and scripts/validate-data.mjs fails a shipped
// name that still reads like a page title. Plain ESM with a `.d.mts` sidecar.
//
// The rule is for the curated layer only. A base-layer OSM name such as
// "Rendez - Vous" is a name a mapper typed, not a page title.
import { isNonPublicVenueName } from "./nonPublicVenueName.mjs";
import { stripOperatorSuffix } from "./venueOperatorSuffix.mjs";

// Real names that contain a title mark. These are never cut. Add a name here
// only when the pub's own sign or site uses the mark.
const REAL_NAMES_WITH_TITLE_MARKS = new Set([]);

// " | ", " - " and ": " separate a page title's parts. The first part is the name.
const TITLE_SEPARATOR_RE = /\s*\|\s*|\s+[-–—]\s+|:\s+/;
// "Ship Tavern, London" names the city a page title adds, not the pub.
const CITY_TAIL_RE = /\s*,\s*london$/i;
// "The Abbey Tavern Pub | Kentish Town": the word before the bar describes the place.
const DESCRIPTOR_BEFORE_PIPE_RE = /\s+pub\s*\|.*$/i;

/**
 * The curated venue's name without its operator suffix and page-title parts.
 * A name that would come back empty comes back as it was. So does a name whose
 * cut part is the only word that the bar is not public ("The Three Tuns - LSE
 * Student Union"): the name is the only access evidence the public rankings
 * and plans read (lib/nonPublicVenueName.mjs).
 */
export function cleanVenueName(name) {
  const raw = String(name ?? "").trim();
  if (REAL_NAMES_WITH_TITLE_MARKS.has(raw)) return raw;
  const clean = stripOperatorSuffix(raw)
    .replace(DESCRIPTOR_BEFORE_PIPE_RE, "")
    .split(TITLE_SEPARATOR_RE)[0]
    .replace(CITY_TAIL_RE, "")
    .trim();
  if (!clean) return raw;
  return isNonPublicVenueName(raw) && !isNonPublicVenueName(clean) ? raw : clean;
}

/**
 * Why a shipped curated row's name is wrong, or nothing when it is right. The
 * shown name must be clean, and the dataset's name beside it must clean to it.
 */
export function curatedVenueNameErrors(row) {
  const name = String(row?.name ?? "");
  const errors = [];
  const clean = cleanVenueName(name);
  if (clean !== name) {
    errors.push(`name "${name}" reads like a page title; the pipeline shows "${clean}"`);
  }
  if (row?.sourceName !== undefined) {
    const source = String(row.sourceName);
    if (source === name) {
      errors.push(`sourceName "${source}" repeats the shown name`);
    } else if (cleanVenueName(source) !== name) {
      errors.push(`sourceName "${source}" cleans to "${cleanVenueName(source)}", not the shown name "${name}"`);
    }
  }
  return errors;
}
