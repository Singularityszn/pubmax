/**
 * The reader for the LONDON VENUE layer - the kind-tagged shards of everywhere
 * in Greater London a drinker or a laptop could sit
 * (`scripts/build_london_venue_shards.mjs`, `public/data/london_venues/`).
 *
 * This is a PARSER and nothing else: no fetching, no map, no component. It sits
 * beside `lib/ukBasePubs.ts` rather than inside it, because that module is the
 * country-wide `amenity=pub` layer whose row tuple ends in a curated venue id
 * and whose every reader draws a PUB. A library is not a pub, so it gets its own
 * id prefix, its own row shape and its own decoder.
 *
 * WHAT A ROW MAY SAY: name, address, position and kind - the four things OSM
 * stated. There is no price field, no band and no opening claim, by
 * construction. `isPubVenueKind` answers false for every non-pub kind here, so
 * nothing on this layer can reach a price band, a pin figure, a cheapest bucket
 * or the Pint Index.
 *
 * OSM data is © OpenStreetMap contributors, ODbL 1.0.
 */

import {
  bboxIntersects,
  parseShardManifest,
  type MapBounds,
  type ShardEntry,
  type ShardManifest,
} from "@/lib/slimShards";
import { isVenueKind, type VenueKind } from "@/lib/venues";
import { discardBody } from "@/lib/responseBody";

export const LONDON_VENUE_SHARD_VERSION = 1;
export const LONDON_VENUE_MANIFEST_PATH = "/data/london_venues/manifest.json";
export const MAX_LONDON_VENUE_RESIDENT_SHARDS = 12;

const LONDON_VENUE_URL_PREFIX = /^\/data\/london_venues\/(?:packs\/[a-f0-9]{16}\/)?$/;

/**
 * Venue ids are salted apart from BOTH the curated `venue-…` convention and the
 * base layer's `venue-uk-…`, so no reader can mistake a cafe for either a
 * curated venue or an unpriced pub. A shared prefix is how a kind-neutral row
 * would end up inside a pub system.
 */
export const LONDON_VENUE_ID_PREFIX = "venue-osm-";

/** One place on the London venue layer. No price field exists. */
export type LondonVenue = {
  /** `venue-osm-<osm ref>`, e.g. `venue-osm-n251829660`. Stable across refreshes. */
  id: string;
  name: string;
  /** OSM address, or "" when the pack had none. Never invented. */
  address: string;
  lat: number;
  lng: number;
  kind: VenueKind;
};

export function londonVenueIdFor(osmRef: string): string {
  return `${LONDON_VENUE_ID_PREFIX}${osmRef}`;
}

export function isLondonVenueId(id: string): boolean {
  return id.startsWith(LONDON_VENUE_ID_PREFIX);
}

/**
 * One shard row is a tuple, not an object, for the reason the base layer's is:
 * the bodies are machine-generated and fetched while the user pans.
 * `[osmRef, name, address, lat, lng, kind]`.
 */
type ShardRow = [string, string, string, number, number, string];

function isShardRow(value: unknown): value is ShardRow {
  return (
    Array.isArray(value) &&
    value.length === 6 &&
    typeof value[0] === "string" &&
    value[0].length > 0 &&
    typeof value[1] === "string" &&
    value[1].length > 0 &&
    typeof value[2] === "string" &&
    typeof value[3] === "number" &&
    Number.isFinite(value[3]) &&
    typeof value[4] === "number" &&
    Number.isFinite(value[4]) &&
    isVenueKind(value[5])
  );
}

/**
 * Parse a shard body into venues, dropping malformed rows rather than letting a
 * drifted refresh poison a reader. A row whose kind the vocabulary does not
 * hold is malformed: a venue with no honest kind has no honest label either.
 */
export function parseLondonVenueShard(value: unknown): LondonVenue[] {
  if (typeof value !== "object" || value === null) return [];
  const rows = (value as Record<string, unknown>).venues;
  if (!Array.isArray(rows)) return [];
  const venues: LondonVenue[] = [];
  for (const row of rows) {
    if (!isShardRow(row)) continue;
    venues.push({
      id: londonVenueIdFor(row[0]),
      name: row[1],
      address: row[2],
      lat: row[3],
      lng: row[4],
      kind: row[5] as VenueKind,
    });
  }
  return venues;
}

export function parseLondonVenueShardForEntry(
  value: unknown,
  entry: ShardEntry,
): LondonVenue[] | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  if (
    record.version !== LONDON_VENUE_SHARD_VERSION ||
    record.cell !== entry.id ||
    !Array.isArray(record.venues) ||
    record.venues.length !== entry.count
  ) {
    return null;
  }
  const venues = parseLondonVenueShard(value);
  return venues.length === entry.count ? venues : null;
}

export function parseLondonVenueManifest(value: unknown): ShardManifest | null {
  if (typeof value !== "object" || value === null) return null;
  const manifest = value as Record<string, unknown>;
  if (
    typeof manifest.urlPrefix !== "string" ||
    !LONDON_VENUE_URL_PREFIX.test(manifest.urlPrefix) ||
    !Array.isArray(manifest.shards)
  ) {
    return null;
  }
  const shards: Record<string, unknown>[] = [];
  for (const raw of manifest.shards) {
    if (typeof raw !== "object" || raw === null || "url" in raw) return null;
    const shard = raw as Record<string, unknown>;
    if (
      typeof shard.id !== "string" ||
      !shard.id ||
      shard.id.includes("/") ||
      shard.id.includes("\\") ||
      shard.id.includes("..")
    ) {
      return null;
    }
    shards.push({ ...shard, url: `${manifest.urlPrefix}${shard.id}.json` });
  }
  return parseShardManifest({ ...manifest, shards });
}

/**
 * Narrow a decoded shard to the kinds a caller asked for. A caller that wants
 * pubs is better served by the curated layer and the base layer; this exists so
 * a work-spot reader can ask for cafes, coworking and libraries without every
 * such reader restating the set.
 */
export function londonVenuesOfKind(
  venues: readonly LondonVenue[],
  kinds: readonly VenueKind[],
): LondonVenue[] {
  const wanted = new Set(kinds);
  return venues.filter((venue) => wanted.has(venue.kind));
}

/** The work-spot kinds: somewhere with a table, a socket and a reason to stay. */
export const WORK_SPOT_KINDS: readonly VenueKind[] = ["cafe", "coworking", "library"];

export type LondonVenueLoader = {
  venuesForBounds(bounds: MapBounds): Promise<LondonVenue[]>;
  residentShardCount(): number;
};

/**
 * Build one viewport loader for one map instance. The wider layer deliberately
 * drops pub rows because curated pins and the UK base layer already own pubs.
 */
export function createLondonVenueLoader(): LondonVenueLoader {
  let manifestPromise: Promise<ShardManifest | null> | null = null;
  const resident = new Map<string, LondonVenue[]>();
  const inFlight = new Map<string, Promise<LondonVenue[]>>();

  async function fetchManifest(): Promise<ShardManifest | null> {
    try {
      const response = await fetch(LONDON_VENUE_MANIFEST_PATH);
      if (!response.ok) {
        discardBody(response);
        return null;
      }
      return parseLondonVenueManifest(await response.json());
    } catch {
      return null;
    }
  }

  function manifest(): Promise<ShardManifest | null> {
    if (!manifestPromise) {
      manifestPromise = fetchManifest().then((parsed) => {
        if (!parsed) manifestPromise = null;
        return parsed;
      });
    }
    return manifestPromise;
  }

  function touch(url: string, venues: LondonVenue[]): void {
    resident.delete(url);
    resident.set(url, venues);
  }

  function prune(keep: ReadonlySet<string>): void {
    for (const url of [...resident.keys()]) {
      if (resident.size <= MAX_LONDON_VENUE_RESIDENT_SHARDS) break;
      if (keep.has(url)) continue;
      resident.delete(url);
    }
    for (const url of [...resident.keys()]) {
      if (resident.size <= MAX_LONDON_VENUE_RESIDENT_SHARDS) break;
      resident.delete(url);
    }
  }

  function loadShard(entry: ShardEntry): Promise<LondonVenue[]> {
    const cached = resident.get(entry.url);
    if (cached) {
      touch(entry.url, cached);
      return Promise.resolve(cached);
    }
    const pending = inFlight.get(entry.url);
    if (pending) return pending;

    const request = fetch(entry.url)
      .then(async (response) => {
        if (!response.ok) {
          discardBody(response);
          throw new Error(`HTTP ${response.status}`);
        }
        const decoded = parseLondonVenueShardForEntry(await response.json(), entry);
        if (!decoded) throw new Error("Invalid London venue shard");
        const venues = decoded.filter((venue) => venue.kind !== "pub");
        touch(entry.url, venues);
        return venues;
      })
      .catch(() => [] as LondonVenue[])
      .finally(() => {
        inFlight.delete(entry.url);
      });
    inFlight.set(entry.url, request);
    return request;
  }

  return {
    async venuesForBounds(bounds) {
      const index = await manifest();
      if (!index) return [];
      const entries = index.shards.filter((entry) => bboxIntersects(entry.bbox, bounds));
      const keep = new Set(entries.map((entry) => entry.url));
      const venues = (await Promise.all(entries.map(loadShard))).flat();
      prune(keep);
      return venues;
    },
    residentShardCount() {
      return resident.size;
    },
  };
}
