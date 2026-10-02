import "server-only";

import { promises as fs } from "fs";
import path from "path";

import { VENUE_ALIAS_FILES } from "@/lib/venueAliasesFile.mjs";

// Venue-id alias resolution (D1). An id a reader may still hold can stop naming
// a venue in two ways, and both are recorded as `oldId -> currentId`:
//
//   * public/data/venue_id_aliases.json - the bundled London dataset collapses
//     the same physical pub's duplicate lineages into one canonical venue id
//     (scripts/canonicalize_venue_dataset.mjs).
//   * public/data/cities/venue_id_aliases.json - a city pack refresh re-derives
//     a pub's id from its name, address and point, so an OSM edit to any of
//     them supersedes the id (scripts/fetch_city_osm_pubs.mjs).
//
// Venue ids are referenced by pint drops, plans and saved lists, so a stored
// reference to an old id must still resolve at every server-side
// lookup-by-id seam, and a read keyed by the current id must still find what
// was stored under an old one.
//
// Reads the alias artifacts with `fs`, so import ONLY from server code (route
// handlers, server components), same rule as lib/venueIndex.ts. Never throws: a
// missing/corrupt alias file degrades to an identity map (ids resolve to
// themselves) rather than 500-ing a page.

type AliasDoc = { aliases?: Record<string, unknown> };
type AliasLoadResult =
  | { status: "ready"; aliases: Map<string, string> }
  | { status: "unavailable" };

export type CanonicalVenueIdLookup =
  | { status: "resolved"; venueId: string }
  | { status: "unavailable" };

let cached: Map<string, string> | null = null;
let aliasPaths = VENUE_ALIAS_FILES.map((file) =>
  path.join(/* turbopackIgnore: true */ process.cwd(), file),
);

async function readAliasDoc(file: string): Promise<Record<string, unknown> | null> {
  const doc = JSON.parse(
    await fs.readFile(/* turbopackIgnore: true */ file, "utf8"),
  ) as AliasDoc;
  const aliases = doc?.aliases;
  return aliases && typeof aliases === "object" ? aliases : null;
}

async function loadAliases(): Promise<AliasLoadResult> {
  if (cached) return { status: "ready", aliases: cached };
  const map = new Map<string, string>();
  try {
    for (const file of aliasPaths) {
      const aliases = await readAliasDoc(file);
      if (!aliases) return { status: "unavailable" };
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
    return { status: "ready", aliases: cached };
  } catch {
    // No alias file (fresh checkout before generation, or a read error) — every
    // id resolves to itself for THIS call, but nothing is cached so a later
    // call can retry once the file exists/is readable.
    return { status: "unavailable" };
  }
}

export async function lookupCanonicalVenueId(id: string): Promise<CanonicalVenueIdLookup> {
  const result = await loadAliases();
  if (result.status === "unavailable") return result;
  return { status: "resolved", venueId: result.aliases.get(id) ?? id };
}

// Map a possibly-merged (duplicate-lineage) venue id to its canonical id.
// Returns the input unchanged when the id has no alias — so callers can wrap a
// direct lookup without changing behaviour for the common (non-aliased) case.
export async function resolveCanonicalVenueId(id: string): Promise<string> {
  if (!id) return id;
  const result = await lookupCanonicalVenueId(id);
  return result.status === "resolved" ? result.venueId : id;
}

/**
 * The alias map in both directions, loaded once, for a reader that resolves
 * many stored ids in one pass or queries a store keyed by the id it was
 * written under. An unavailable map answers as the identity.
 */
export type VenueAliasResolver = {
  /** The current id a stored reference resolves to. */
  canonical(id: string): string;
  /** Every id a reference to this venue may be stored under, current id first. */
  storedIds(id: string): string[];
};

export async function loadVenueAliasResolver(): Promise<VenueAliasResolver> {
  const result = await loadAliases();
  const aliases = result.status === "ready" ? result.aliases : new Map<string, string>();
  const formerIds = new Map<string, string[]>();
  for (const [from, to] of aliases) {
    const list = formerIds.get(to);
    if (list) list.push(from);
    else formerIds.set(to, [from]);
  }
  const canonical = (id: string) => aliases.get(id) ?? id;
  return {
    canonical,
    storedIds(id) {
      const current = canonical(id);
      return [current, ...(formerIds.get(current) ?? [])];
    },
  };
}

export function resetVenueAliasesForTests(): void {
  if (
    process.env.NODE_ENV === "test" ||
    Boolean(process.env.VITEST) ||
    Boolean(process.env.VITEST_WORKER_ID)
  ) {
    cached = null;
    aliasPaths = VENUE_ALIAS_FILES.map((file) =>
      path.join(/* turbopackIgnore: true */ process.cwd(), file),
    );
  }
}

export function setVenueAliasesPathForTests(file: string): void {
  if (
    process.env.NODE_ENV === "test" ||
    Boolean(process.env.VITEST) ||
    Boolean(process.env.VITEST_WORKER_ID)
  ) {
    cached = null;
    aliasPaths = [file];
  }
}
