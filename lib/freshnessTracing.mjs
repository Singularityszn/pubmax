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
