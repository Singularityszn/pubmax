// Where the map's EAGER slim shard lives, as ONE string.
//
// The map loads this shard on first paint and pulls a borough shard only when
// the viewport or a geolocation fix asks for it (lib/slimShards.ts), so a
// `?sel=` arrival can only resolve against this file. A server surface that
// wants to know whether the map could open a pub reads it at request time
// (lib/mapEagerVenueIndex.server.ts), which Next cannot trace statically, so
// next.config.mjs declares it through lib/venueIndexTracing.mjs. Plain ESM with
// no imports so the config can read it while Next loads, and so the file the
// function ships and the file the reader opens stay one string.

/** Repo-relative path, as the reader joins it to process.cwd(). */
export const MAP_EAGER_VENUE_INDEX_FILE = "public/data/venues_slim.core.json";

/** The same file as Next's outputFileTracingIncludes spells it. */
export const MAP_EAGER_VENUE_INDEX_TRACING_INCLUDE = `./${MAP_EAGER_VENUE_INDEX_FILE}`;

export const MAP_EAGER_VENUE_INDEX_TRACING_INCLUDES = [
  MAP_EAGER_VENUE_INDEX_TRACING_INCLUDE,
  "./public/data/venues_slim.manifest.json",
  "./public/data/venues_slim.cell.*.json",
];
