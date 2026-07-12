import { promises as fs } from "fs";
import path from "path";

import { listEnabledCities } from "@/lib/cities";
import { cityIdFromVenueId } from "@/lib/cityVenueIds";
import { resolveCanonicalVenueId } from "@/lib/venueAliases";
import { slimVenueToPin } from "@/lib/slimPins";
import { enrichVenueForDetail } from "@/lib/venueMenuEnrichment";
import { groupVenuePrices, type Venue, type VenuePrice } from "@/lib/venues";
import type { SlimVenue } from "@/lib/venuesSlim";

export type VenueDetailManifestEntry = {
  offset: number;
  length: number;
  rowCount: number;
};

export type VenueDetailManifest = {
  version: 1;
  detailsFile: string;
  count: number;
  venues: Record<string, VenueDetailManifestEntry>;
};

export type VenueDetailArtifact = {
  id: string;
  rows: VenuePrice[];
};

const GENERATED_DIR =
  process.env.PUBMAX_VENUE_DETAIL_DIR ?? path.join(process.cwd(), "data", "generated");
const DEFAULT_DETAIL_INDEX_FILE = path.join(GENERATED_DIR, "venue_detail_index.json");
const DEFAULT_DETAIL_ROWS_FILE = path.join(GENERATED_DIR, "venue_details.jsonl");
const RAW_DATASET_FILE = path.join(process.cwd(), "public", "data", "pint_prices_app_dataset.json");

// Suffix bound is deliberately loose ({1,24}) so a future id generator that
// bumps the entropy segment beyond today's 12 chars won't need a regex change.
const VENUE_ID_RE = /^venue-(?:[a-z]{3}-)?[a-z0-9]{1,24}$/;

const cachedDetails = new Map<string, Venue>();
/** Successful manifests only — I/O failures stay unset so the next call can retry.
 * Schema-invalid manifests are cached as INVALID_MANIFEST (warn once). */
const INVALID_MANIFEST = Symbol("invalid-venue-detail-manifest");
let cachedManifest: VenueDetailManifest | typeof INVALID_MANIFEST | undefined;
let detailIndexFile = DEFAULT_DETAIL_INDEX_FILE;
let detailRowsFile = DEFAULT_DETAIL_ROWS_FILE;
let fallbackIndex: Map<string, Venue> | null = null;
let manifestReadAttemptsForTests = 0;

function isTestRuntime(): boolean {
  return (
    process.env.NODE_ENV === "test" ||
    Boolean(process.env.VITEST) ||
    Boolean(process.env.VITEST_WORKER_ID)
  );
}

export function isVenueDetailId(id: string): boolean {
  return VENUE_ID_RE.test(id);
}

export function venueFromDetailArtifact(
  artifact: VenueDetailArtifact,
  expectedId: string,
): Venue | null {
  if (artifact.id !== expectedId || !Array.isArray(artifact.rows) || artifact.rows.length === 0) {
    return null;
  }
  const venue = groupVenuePrices(artifact.rows)[0];
  return venue?.id === expectedId ? venue : null;
}

/** Sentinel: schema-invalid manifest is permanent for this process (do not re-read). */
async function readManifest(): Promise<VenueDetailManifest | null> {
  if (cachedManifest === INVALID_MANIFEST) return null;
  if (cachedManifest) return cachedManifest;
  if (isTestRuntime()) manifestReadAttemptsForTests += 1;
  try {
    const parsed = JSON.parse(await fs.readFile(detailIndexFile, "utf8")) as VenueDetailManifest;
    const valid =
      parsed.version === 1 &&
      parsed.detailsFile === "venue_details.jsonl" &&
      typeof parsed.count === "number" &&
      typeof parsed.venues === "object" &&
      parsed.venues !== null;
    if (!valid) {
      // Permanently malformed build artifact — cache the miss and warn once.
      cachedManifest = INVALID_MANIFEST;
      console.warn(
        "[venueDetailIndex] venue_detail_index.json failed schema validation; venue detail lookups disabled until restart",
      );
      return null;
    }
    cachedManifest = parsed;
    return parsed;
  } catch {
    // Leave cache unset so a later request can retry after a transient miss.
    return null;
  }
}

async function readVenueFromArtifact(id: string): Promise<Venue | null | undefined> {
  const manifest = await readManifest();
  const entry = manifest?.venues[id];
  if (!manifest || !entry) return manifest ? null : undefined;
  if (
    !Number.isSafeInteger(entry.offset) ||
    !Number.isSafeInteger(entry.length) ||
    entry.offset < 0 ||
    entry.length <= 0
  ) {
    return null;
  }

  let file: Awaited<ReturnType<typeof fs.open>> | null = null;
  try {
    file = await fs.open(detailRowsFile, "r");
    const buffer = Buffer.alloc(entry.length);
    const { bytesRead } = await file.read(buffer, 0, entry.length, entry.offset);
    if (bytesRead !== entry.length) return null;
    const artifact = JSON.parse(buffer.toString("utf8").trim()) as VenueDetailArtifact;
    return venueFromDetailArtifact(artifact, id);
  } catch {
    return null;
  } finally {
    await file?.close().catch(() => {});
  }
}

async function getFallbackIndex(): Promise<Map<string, Venue>> {
  if (fallbackIndex) return fallbackIndex;
  const index = new Map<string, Venue>();
  try {
    const rows = JSON.parse(await fs.readFile(RAW_DATASET_FILE, "utf8")) as VenuePrice[];
    for (const venue of groupVenuePrices(Array.isArray(rows) ? rows : [])) {
      index.set(venue.id, venue);
    }
  } catch {
    // Keep development and tests friendly if generated artifacts are absent.
  }
  fallbackIndex = index;
  return fallbackIndex;
}

/** Successful city slim packs only — I/O failures stay unset so the next call can retry. */
let cachedCitySlimPins: Map<string, Venue> | null | undefined;

function publicDataPath(publicPath: string): string {
  return path.join(process.cwd(), "public", publicPath.replace(/^\//, ""));
}

async function getCitySlimPinIndex(): Promise<Map<string, Venue>> {
  if (cachedCitySlimPins) return cachedCitySlimPins;
  const index = new Map<string, Venue>();
  let loadedAny = false;
  for (const city of listEnabledCities()) {
    if (city.id === "london") continue;
    try {
      const rows = JSON.parse(
        await fs.readFile(publicDataPath(city.slimVenuesPath), "utf8"),
      ) as SlimVenue[];
      loadedAny = true;
      if (!Array.isArray(rows)) continue;
      for (const row of rows) {
        if (
          typeof row?.id === "string" &&
          typeof row.name === "string" &&
          Number.isFinite(row.lat) &&
          Number.isFinite(row.lng)
        ) {
          index.set(row.id, slimVenueToPin(row));
        }
      }
    } catch {
      // One missing/corrupt city pack must not wipe the rest; leave cache unset
      // only when every city fails so a later request can retry.
    }
  }
  if (!loadedAny) return new Map();
  cachedCitySlimPins = index;
  return index;
}

export async function getVenueDetail(requestedId: string): Promise<Venue | null> {
  if (!isVenueDetailId(requestedId)) return null;
  // Resolve a merged duplicate id (D1) to its canonical id up front, so detail
  // lookups by a losing id return the surviving venue and cache under one key.
  const id = await resolveCanonicalVenueId(requestedId);
  if (cachedDetails.has(id)) return cachedDetails.get(id) ?? null;

  const artifactVenue = await readVenueFromArtifact(id);
  let venue: Venue | null =
    artifactVenue === undefined && process.env.NODE_ENV !== "production"
      ? (await getFallbackIndex()).get(id) ?? null
      : artifactVenue ?? null;

  // Non-London packs ship slim pins only today — synthesize a minimal Venue so
  // /api/venue/[id] does not 404 every Manchester/Oxford/etc. open.
  if (!venue && cityIdFromVenueId(id)) {
    venue = (await getCitySlimPinIndex()).get(id) ?? null;
  }

  if (venue) {
    venue = await enrichVenueForDetail(venue);
    cachedDetails.set(id, venue);
  }
  return venue;
}

export function resetVenueDetailCachesForTests(): void {
  if (!isTestRuntime()) return;
  cachedDetails.clear();
  cachedManifest = undefined;
  detailIndexFile = DEFAULT_DETAIL_INDEX_FILE;
  detailRowsFile = DEFAULT_DETAIL_ROWS_FILE;
  fallbackIndex = null;
  cachedCitySlimPins = undefined;
  manifestReadAttemptsForTests = 0;
}

/** Clear venue entries only — leaves manifest cache as-is (for sticky-failure tests). */
export function clearVenueDetailEntriesForTests(): void {
  if (!isTestRuntime()) return;
  cachedDetails.clear();
  fallbackIndex = null;
  cachedCitySlimPins = undefined;
}

export function setVenueDetailIndexFileForTests(file: string): void {
  if (!isTestRuntime()) return;
  cachedDetails.clear();
  cachedManifest = undefined;
  detailIndexFile = file;
}

export function setVenueDetailRowsFileForTests(file: string): void {
  if (!isTestRuntime()) return;
  cachedDetails.clear();
  detailRowsFile = file;
}

export function getManifestReadAttemptsForTests(): number {
  return isTestRuntime() ? manifestReadAttemptsForTests : 0;
}
