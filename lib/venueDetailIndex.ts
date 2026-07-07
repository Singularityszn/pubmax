import { promises as fs } from "fs";
import path from "path";

import { groupVenuePrices, type Venue, type VenuePrice } from "@/lib/venues";

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
const DETAIL_INDEX_FILE = path.join(GENERATED_DIR, "venue_detail_index.json");
const DEFAULT_DETAIL_ROWS_FILE = path.join(GENERATED_DIR, "venue_details.jsonl");
const RAW_DATASET_FILE = path.join(process.cwd(), "public", "data", "pint_prices_app_dataset.json");

const VENUE_ID_RE = /^venue-[a-z0-9]{1,12}$/;

const cachedDetails = new Map<string, Venue>();
let cachedManifest: VenueDetailManifest | null | undefined;
let detailRowsFile = DEFAULT_DETAIL_ROWS_FILE;
let fallbackIndex: Map<string, Venue> | null = null;

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

async function readManifest(): Promise<VenueDetailManifest | null> {
  if (cachedManifest !== undefined) return cachedManifest;
  try {
    const parsed = JSON.parse(await fs.readFile(DETAIL_INDEX_FILE, "utf8")) as VenueDetailManifest;
    cachedManifest =
      parsed.version === 1 &&
      parsed.detailsFile === "venue_details.jsonl" &&
      typeof parsed.count === "number" &&
      typeof parsed.venues === "object" &&
      parsed.venues !== null
        ? parsed
        : null;
  } catch {
    cachedManifest = null;
  }
  return cachedManifest;
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

export async function getVenueDetail(id: string): Promise<Venue | null> {
  if (!isVenueDetailId(id)) return null;
  if (cachedDetails.has(id)) return cachedDetails.get(id) ?? null;

  const artifactVenue = await readVenueFromArtifact(id);
  const venue =
    artifactVenue === undefined && process.env.NODE_ENV !== "production"
      ? (await getFallbackIndex()).get(id) ?? null
      : artifactVenue ?? null;

  if (venue) cachedDetails.set(id, venue);
  return venue;
}

export function resetVenueDetailCachesForTests(): void {
  if (!isTestRuntime()) return;
  cachedDetails.clear();
  cachedManifest = undefined;
  detailRowsFile = DEFAULT_DETAIL_ROWS_FILE;
  fallbackIndex = null;
}

export function setVenueDetailRowsFileForTests(file: string): void {
  if (!isTestRuntime()) return;
  cachedDetails.clear();
  detailRowsFile = file;
}
