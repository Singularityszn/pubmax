import "server-only";

import { promises as fs } from "fs";
import path from "path";

import { VENUE_ALIAS_FILES } from "@/lib/venueAliasesFile.mjs";

// Venue-id alias resolution (D1). An id a reader may still hold can stop naming
// a venue in three ways, and each is recorded as `oldId -> currentId`:
//
//   * public/data/venue_id_aliases.json - the bundled London dataset collapses
//     the same physical pub's duplicate lineages into one canonical venue id
//     (scripts/canonicalize_venue_dataset.mjs).
//   * public/data/cities/venue_id_aliases.json - a city pack refresh re-derives
//     a pub's id from its name, address and point, so an OSM edit to any of
//     them supersedes the id (scripts/fetch_city_osm_pubs.mjs).
//   * public/data/uk_base_venue_id_aliases.json - a UK base refresh that drops
//     an OSM object drops its `venue-uk-*` id, and the same pub re-mapped as a
//     new object carries a new one (scripts/build_uk_base_shards.mjs).
//
// Venue ids are referenced by pint drops, plans and saved lists, so a stored
// reference to an old id must still resolve at every server-side
// lookup-by-id seam, and a read keyed by the current id must still find what
// was stored under an old one. A city or base pub that left OpenStreetMap with no
// successor is RETIRED: its alias file keeps its name, area and last point, so
// a reference to it still names that pub while the map no longer lists it.
//
// Reads the alias artifacts with `fs`, so import ONLY from server code (route
// handlers, server components), same rule as lib/venueIndex.ts. Never throws: a
// missing/corrupt alias file degrades to an identity map (ids resolve to
// themselves) rather than 500-ing a page.

/** A pub no pack lists any more, as a stored reference to it is still answered. */
export type RetiredVenue = { id: string; name: string; area: string; lat: number; lng: number };

type AliasDoc = { aliases?: Record<string, unknown>; retired?: Record<string, unknown> };
type AliasMaps = { aliases: Map<string, string>; retired: Map<string, RetiredVenue> };
type AliasLoadResult = ({ status: "ready" } & AliasMaps) | { status: "unavailable" };

export type CanonicalVenueIdLookup =
  | { status: "resolved"; venueId: string }
  | { status: "unavailable" };

let cached: AliasMaps | null = null;
let aliasPaths = VENUE_ALIAS_FILES.map((file) =>
  path.join(/* turbopackIgnore: true */ process.cwd(), file),
);

async function readAliasDoc(file: string): Promise<AliasDoc | null> {
  const doc = JSON.parse(
    await fs.readFile(/* turbopackIgnore: true */ file, "utf8"),
  ) as AliasDoc;
  const aliases = doc?.aliases;
  return aliases && typeof aliases === "object" ? doc : null;
}

function retiredVenueFrom(id: string, value: unknown): RetiredVenue | null {
  if (!value || typeof value !== "object") return null;
  const { name, area, lat, lng } = value as Record<string, unknown>;
  if (typeof name !== "string" || !name || typeof area !== "string" || !area) return null;
  if (typeof lat !== "number" || !Number.isFinite(lat) || typeof lng !== "number" || !Number.isFinite(lng)) {
    return null;
  }
  return { id, name, area, lat, lng };
}

async function loadAliases(): Promise<AliasLoadResult> {
  if (cached) return { status: "ready", ...cached };
  const maps: AliasMaps = { aliases: new Map(), retired: new Map() };
  try {
    for (const file of aliasPaths) {
      const doc = await readAliasDoc(file);
      if (!doc?.aliases) return { status: "unavailable" };
      for (const [from, to] of Object.entries(doc.aliases)) {
        // Skip self-maps and non-string targets so a bad row can't create a
        // cycle or resolve an id to a non-id.
        if (typeof to === "string" && to && from !== to) maps.aliases.set(from, to);
      }
      for (const [id, value] of Object.entries(doc.retired ?? {})) {
        const venue = retiredVenueFrom(id, value);
        if (venue) maps.retired.set(id, venue);
      }
    }
    // Cache only a successful load. A file that's missing/corrupt now but
    // created/repaired later must be picked up on the next call — never poison
    // the cache with an empty map from a transient failure.
    cached = maps;
    return { status: "ready", ...cached };
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
  /** The retired pub this id names, or null when it names none. */
  retired(id: string): RetiredVenue | null;
};

/**
 * Every id a row about this venue may be stored under, current id first. The
 * one rule every store read keyed by a venue id runs through, so a row written
 * under a merged, superseded or dropped id is still read as the venue's own.
 */
export async function storedVenueIds(venueId: string): Promise<string[]> {
  return (await loadVenueAliasResolver()).storedIds(venueId);
}

/** The retired pub this id names, or null. Null too when the alias files cannot be read. */
export async function lookupRetiredVenue(id: string): Promise<RetiredVenue | null> {
  return (await loadVenueAliasResolver()).retired(id);
}

export async function loadVenueAliasResolver(): Promise<VenueAliasResolver> {
  const result = await loadAliases();
  const aliases = result.status === "ready" ? result.aliases : new Map<string, string>();
  const retired = result.status === "ready" ? result.retired : new Map<string, RetiredVenue>();
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
    retired(id) {
      return retired.get(canonical(id)) ?? null;
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
