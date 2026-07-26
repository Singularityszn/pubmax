import { promises as fs } from "fs";
import path from "path";

// Duplicate-venue-identity alias resolution (D1). The bundled dataset collapses
// the same physical pub's duplicate lineages into one canonical venue id (see
// scripts/canonicalize_venue_dataset.mjs), and records every losing id in
// public/data/venue_id_aliases.json as `duplicateId -> canonicalId`. Venue ids
// are referenced by pint drops, plans and saved lists, so a stored reference to
// a merged id must still resolve at every server-side lookup-by-id seam.
//
// Reads the alias artifact with `fs`, so import ONLY from server code (route
// handlers, server components), same rule as lib/venueIndex.ts. Never throws: a
// missing/corrupt alias file degrades to an identity map (ids resolve to
// themselves) rather than 500-ing a page.

type AliasDoc = { aliases?: Record<string, unknown> };

let cached: Map<string, string> | null = null;
let aliasPath = path.join(process.cwd(), "public", "data", "venue_id_aliases.json");

async function loadAliases(): Promise<Map<string, string>> {
  if (cached) return cached;
  const map = new Map<string, string>();
  try {
    const doc = JSON.parse(await fs.readFile(aliasPath, "utf8")) as AliasDoc;
    const aliases = doc?.aliases;
    if (aliases && typeof aliases === "object") {
      for (const [from, to] of Object.entries(aliases)) {
        // Skip self-maps and non-string targets so a bad row can't create a
        // cycle or resolve an id to a non-id.
        if (typeof to === "string" && to && from !== to) map.set(from, to);
      }
    }
    // Cache only a successful load. A file that's missing/corrupt now but
    // created/repaired later must be picked up on the next call — never poison
    // the cache with an empty map from a transient failure.
    cached = map;
    return cached;
  } catch {
    // No alias file (fresh checkout before generation, or a read error) — every
    // id resolves to itself for THIS call, but nothing is cached so a later
    // call can retry once the file exists/is readable.
    return map;
  }
}

// Map a possibly-merged (duplicate-lineage) venue id to its canonical id.
// Returns the input unchanged when the id has no alias — so callers can wrap a
// direct lookup without changing behaviour for the common (non-aliased) case.
export async function resolveCanonicalVenueId(id: string): Promise<string> {
  if (!id) return id;
  const map = await loadAliases();
  return map.get(id) ?? id;
}

export function resetVenueAliasesForTests(): void {
  if (
    process.env.NODE_ENV === "test" ||
    Boolean(process.env.VITEST) ||
    Boolean(process.env.VITEST_WORKER_ID)
  ) {
    cached = null;
    aliasPath = path.join(process.cwd(), "public", "data", "venue_id_aliases.json");
  }
}

export function setVenueAliasesPathForTests(file: string): void {
  if (
    process.env.NODE_ENV === "test" ||
    Boolean(process.env.VITEST) ||
    Boolean(process.env.VITEST_WORKER_ID)
  ) {
    cached = null;
    aliasPath = file;
  }
}
