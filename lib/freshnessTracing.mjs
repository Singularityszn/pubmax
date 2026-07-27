// Which registry artifacts a freshness serverless function has to carry.
//
// Only a dataset whose stamp is `{ kind: "field" }` is ever opened at runtime:
// a literal stamp is answered from the registry itself and a dataset with no
// stamp is never dated at all (lib/freshness.ts resolveStamp returns before it
// looks at the read). Tracing the rest would push megabytes of unrelated payload
// into both functions for nothing — the same bloat that ruled out a
// public/data/**/*.json glob.
//
// Plain ESM with no imports so next.config.mjs can call it while Next loads the
// config, and __tests__/freshnessTracing.test.ts can drive it with a synthetic
// registry to prove a newly field-stamped dataset is traced with no edit here.

/**
 * @param {{ datasets?: ReadonlyArray<{ artifact?: string | null, stamp?: { kind?: string } | null }> }} registry
 * @returns {string[]} `./`-relative paths for Next's outputFileTracingIncludes.
 */
export function freshnessArtifactIncludes(registry) {
  return (registry?.datasets ?? []).flatMap((dataset) =>
    dataset?.stamp?.kind === "field" && dataset.artifact ? [`./${dataset.artifact}`] : [],
  );
}

/**
 * ONE registered artifact, for a route that opens that dataset at request time
 * and nothing else (the feed's sourced-price overlay). Taken from the registry
 * by id so the path a function ships and the path the spine ages stay the same
 * string, and an unknown id is [] rather than a guess.
 *
 * @param {{ datasets?: ReadonlyArray<{ id?: string, artifact?: string | null }> }} registry
 * @param {string} id
 * @returns {string[]} `./`-relative path for Next's outputFileTracingIncludes.
 */
export function freshnessArtifactIncludeById(registry, id) {
  const dataset = (registry?.datasets ?? []).find((entry) => entry?.id === id);
  return dataset?.artifact ? [`./${dataset.artifact}`] : [];
}
