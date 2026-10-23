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

/**
 * Every `oldId -> currentId` pair the alias artifacts hold, as one map in which
 * each id points straight at the id the chain ends on, so `A -> B -> C` reads
 * `A -> C` in one step and a reverse index built from it holds every former id
 * of `C`. A later pair for the same id wins. Throws on a cycle, because an id
 * in one has no current id, and a caller reading the artifacts treats that as
 * an unreadable alias set while a build refuses to write it. The one place the
 * chain rule lives: the server reader, the browser reader and the build plan
 * all call it.
 *
 * @param {Iterable<readonly [string, string]>} pairs
 * @returns {Map<string, string>}
 */
export function flattenVenueAliasChains(pairs) {
  const direct = new Map();
  for (const [from, to] of pairs) {
    if (from !== to) direct.set(from, to);
  }
  const flat = new Map();
  for (const start of direct.keys()) {
    const seen = [start];
    let current = direct.get(start);
    while (direct.has(current)) {
      if (seen.includes(current)) {
        throw new Error(`venue alias cycle: ${[...seen, current].join(" -> ")}`);
      }
      seen.push(current);
      current = direct.get(current);
    }
    flat.set(start, current);
  }
  return flat;
}
