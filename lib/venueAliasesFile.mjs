// Where the venue-id alias artifacts live, as ONE list of strings.
//
// lib/venueAliases.ts joins each of these to process.cwd() on every server-side
// lookup-by-id, so the files the reader opens and the files next.config.mjs
// declares in outputFileTracingIncludes stay the same strings. Plain ESM with no
// imports so the config can read it while Next loads.

/** Repo-relative path of London's merged-duplicate aliases, written by canonicalize:venues. */
const VENUE_ALIASES_FILE = "public/data/venue_id_aliases.json";

/** Repo-relative path of the city packs' superseded-id aliases, written by fetch:city-pubs. */
export const CITY_VENUE_ALIASES_FILE = "public/data/cities/venue_id_aliases.json";

/** Repo-relative path of the UK base layer's removed-id aliases, written by build:uk-base. */
export const UK_BASE_VENUE_ALIASES_FILE = "public/data/uk_base_venue_id_aliases.json";

/** Every alias artifact the reader merges, in the order it reads them. */
export const VENUE_ALIAS_FILES = [
  VENUE_ALIASES_FILE,
  CITY_VENUE_ALIASES_FILE,
  UK_BASE_VENUE_ALIASES_FILE,
];

/** The same files as Next's outputFileTracingIncludes spells them. */
export const VENUE_ALIASES_TRACING_INCLUDES = VENUE_ALIAS_FILES.map((file) => `./${file}`);
