import "server-only";

// THE PUB AS ITS GENERATED DETAIL ARTIFACT GIVES IT: the grouped price rows, or
// the curated seed, before the venue sheet adds anything. Every addition the
// sheet makes in lib/venueDetailIndex.ts (record copy, menu links, the website
// overlay, Places, site facts and OSM facts) leaves `id`, `kind` and `prices`
// as this read gives them. A reader that needs only the price rows reads them
// here, so it neither waits on those sources nor ships their data packs.

import { promises as fs } from "fs";
import { createHash } from "node:crypto";
import path from "path";

import { cityIdFromVenueId } from "@/lib/cityVenueIds";
import type { FoodCategory } from "@/lib/food";
import { slimVenueToPin } from "@/lib/slimPins";
import { lookupCanonicalVenueId } from "@/lib/venueAliases";
import { lookupCanonicalVenue } from "@/lib/venueIndex";
import { groupVenuePrices, type Venue, type VenuePrice } from "@/lib/venues";
import type { SlimVenue } from "@/lib/venuesSlim";
import { isVerifiedClosedCuratedVenue } from "@/lib/verifiedClosedPubs";

type VenueDetailManifestEntry = {
  offset: number;
  length: number;
  rowCount: number;
  rowDigest?: string;
};

type VenueDetailManifest = {
  version: 1;
  priceDatasetDigest?: string;
  detailsFile: string;
  count: number;
  venues: Record<string, VenueDetailManifestEntry>;
};

export type VenueDetailArtifact = {
  id: string;
  rows?: VenuePrice[];
  famous?: {
    seed: FamousVenueSeed;
    slim: SlimVenue;
  };
};

type FamousVenueSeed = {
  id: string;
  name: string;
  address: string;
  borough: string;
  lat: number;
  lng: number;
  kind: "bar" | "food" | "restaurant";
  sourceUrl: string;
  anchor: {
    label: string;
    price: number;
    observedAt: string;
    sourceUrl: string;
    course?: FoodCategory;
    kind:
      | "house_cocktail"
      | "pint"
      | "wine"
      | "large_doner"
      | "signature_item"
      | "signature_dish";
  };
  story: { text: string; sourceUrl: string };
};

const GENERATED_DIR =
  process.env.PUBMAX_VENUE_DETAIL_DIR ??
  path.join(/* turbopackIgnore: true */ process.cwd(), "data", "generated");
const DEFAULT_DETAIL_INDEX_FILE = path.join(GENERATED_DIR, "venue_detail_index.json");
const DEFAULT_DETAIL_ROWS_FILE = path.join(GENERATED_DIR, "venue_details.jsonl");
const RAW_DATASET_FILE = path.join(process.cwd(), "public", "data", "pint_prices_app_dataset.json");

// Suffix bound is deliberately loose ({1,24}) so a future id generator that
// bumps the entropy segment beyond today's 12 chars won't need a regex change.
const VENUE_ID_RE =
  /^(?:venue-(?:[a-z]{3}-)?[a-z0-9]{1,24}|(?:bar|food|restaurant)-[a-z0-9-]{1,100})$/;

/** Successful manifests only — I/O failures stay unset so the next call can retry.
 * Schema-invalid manifests are cached as INVALID_MANIFEST (warn once). */
const INVALID_MANIFEST = Symbol("invalid-venue-detail-manifest");
let cachedManifest: VenueDetailManifest | typeof INVALID_MANIFEST | undefined;
let detailIndexFile = DEFAULT_DETAIL_INDEX_FILE;
let detailRowsFile = DEFAULT_DETAIL_ROWS_FILE;
let fallbackIndex: Map<string, Venue> | null = null;
let manifestReadAttemptsForTests = 0;

type ArtifactLookupResult =
  | { status: "found"; venue: Venue; priceDatasetDigest?: string }
  | { status: "missing" }
  | { status: "unavailable"; allowFallback: boolean };

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
  if (artifact.id !== expectedId) {
    return null;
  }
  if (artifact.famous) {
    const { seed, slim } = artifact.famous;
    if (seed.id !== expectedId || slim.id !== expectedId) return null;
    const venue = slimVenueToPin(slim);
    return {
      ...venue,
      address: seed.address,
      hasStory: true,
      amenities: {
        ...venue.amenities,
        food: seed.kind === "food" || seed.kind === "restaurant",
        cocktails:
          seed.kind === "bar" && seed.anchor.kind === "house_cocktail",
      },
      website: seed.sourceUrl,
      description: seed.story.text,
      sourceDatasets: ["famous_venues"],
      anchorLabel: seed.anchor.label,
      ...(seed.anchor.course ? { anchorCourse: seed.anchor.course } : {}),
      anchorObservedAt: seed.anchor.observedAt,
      anchorSourceUrl: seed.anchor.sourceUrl,
      storySourceUrl: seed.story.sourceUrl,
    };
  }
  if (!Array.isArray(artifact.rows) || artifact.rows.length === 0) return null;
  const venue = groupVenuePrices(artifact.rows)[0];
  return venue?.id === expectedId ? venue : null;
}

/** Sentinel: schema-invalid manifest is permanent for this process (do not re-read). */
async function readManifest(): Promise<
  | { status: "ready"; manifest: VenueDetailManifest }
  | { status: "unavailable" }
> {
  if (cachedManifest === INVALID_MANIFEST) return { status: "unavailable" };
  if (cachedManifest) return { status: "ready", manifest: cachedManifest };
  if (isTestRuntime()) manifestReadAttemptsForTests += 1;
  try {
    const parsed = JSON.parse(
      await fs.readFile(/* turbopackIgnore: true */ detailIndexFile, "utf8"),
    ) as VenueDetailManifest;
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
      return { status: "unavailable" };
    }
    cachedManifest = parsed;
    return { status: "ready", manifest: parsed };
  } catch {
    // Leave cache unset so a later request can retry after a transient miss.
    return { status: "unavailable" };
  }
}

async function readVenueFromArtifact(id: string): Promise<ArtifactLookupResult> {
  const manifestResult = await readManifest();
  if (manifestResult.status === "unavailable") {
    return { status: "unavailable", allowFallback: true };
  }
  const entry = manifestResult.manifest.venues[id];
  if (!entry) return { status: "missing" };
  if (
    !Number.isSafeInteger(entry.offset) ||
    !Number.isSafeInteger(entry.length) ||
    entry.offset < 0 ||
    entry.length <= 0
  ) {
    return { status: "unavailable", allowFallback: false };
  }

  let file: Awaited<ReturnType<typeof fs.open>> | null = null;
  try {
    file = await fs.open(/* turbopackIgnore: true */ detailRowsFile, "r");
    const buffer = Buffer.alloc(entry.length);
    const { bytesRead } = await file.read(buffer, 0, entry.length, entry.offset);
    if (bytesRead !== entry.length) return { status: "unavailable", allowFallback: false };
    const artifact = JSON.parse(buffer.toString("utf8").trim()) as VenueDetailArtifact;
    const venue = venueFromDetailArtifact(artifact, id);
    const digest = manifestResult.manifest.priceDatasetDigest;
    const validDigest = typeof digest === "string" && /^[A-Za-z0-9_-]{22}$/.test(digest) &&
      typeof entry.rowDigest === "string" && createHash("sha256").update(buffer).digest("base64url").slice(0, 22) === entry.rowDigest;
    return venue
      ? { status: "found", venue, ...(validDigest ? { priceDatasetDigest: digest } : {}) }
      : { status: "unavailable", allowFallback: false };
  } catch {
    return { status: "unavailable", allowFallback: false };
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
  for (const file of ["bars.json", "late_food.json", "restaurants.json"]) {
    try {
      const seeds = JSON.parse(
        await fs.readFile(
          /* turbopackIgnore: true */
          path.join(/* turbopackIgnore: true */ process.cwd(), "data", "famous_venues", file),
          "utf8",
        ),
      ) as Array<Omit<FamousVenueSeed, "anchor"> & { anchor?: FamousVenueSeed["anchor"] }>;
      for (const seed of seeds) {
        const { anchor } = seed;
        if (!anchor) continue;
        const slim: SlimVenue = {
          id: seed.id,
          name: seed.name,
          lat: seed.lat,
          lng: seed.lng,
          cheapestPrice: anchor.price,
          borough: seed.borough,
          kind: seed.kind,
        };
        const venue = venueFromDetailArtifact(
          { id: seed.id, famous: { seed: { ...seed, anchor }, slim } },
          seed.id,
        );
        if (venue) index.set(seed.id, venue);
      }
    } catch {
      // One missing seed pack must not disable legacy development fallback.
    }
  }
  fallbackIndex = index;
  return fallbackIndex;
}

/** The canonical id a detail read answers for. A closed or malformed id is missing. */
export async function resolveVenueDetailId(
  requestedId: string,
): Promise<{ status: "resolved"; id: string } | { status: "missing" } | { status: "unavailable" }> {
  if (!isVenueDetailId(requestedId) || isVerifiedClosedCuratedVenue(requestedId)) {
    return { status: "missing" };
  }
  const aliasResult = await lookupCanonicalVenueId(requestedId);
  if (aliasResult.status === "unavailable") return aliasResult;
  if (isVerifiedClosedCuratedVenue(aliasResult.venueId)) return { status: "missing" };
  return { status: "resolved", id: aliasResult.venueId };
}

/** The artifact's venue for a pub the index knows, or null when no read can give one. */
export async function readVenueDetailBase(
  id: string,
  slimVenue: SlimVenue,
): Promise<{ venue: Venue; priceDatasetDigest?: string } | null> {
  const artifactResult = await readVenueFromArtifact(id);
  if (artifactResult.status === "found") {
    const { venue, priceDatasetDigest } = artifactResult;
    return priceDatasetDigest ? { venue, priceDatasetDigest } : { venue };
  }
  if (
    artifactResult.status === "unavailable" &&
    artifactResult.allowFallback &&
    process.env.NODE_ENV !== "production"
  ) {
    const venue = (await getFallbackIndex()).get(id);
    if (venue) return { venue };
  }
  return cityIdFromVenueId(id) ? { venue: slimVenueToPin(slimVenue) } : null;
}

export type PricedVenueLookupResult =
  | { status: "found"; venue: Venue }
  | { status: "missing" }
  | { status: "unavailable" };

/**
 * The pub with the price rows its public detail serves, and nothing the sheet
 * adds. A retired or unknown pub is missing. Rows are not filtered here: the
 * caller's own rule decides which row, if any, it may quote.
 */
export async function lookupPricedVenue(requestedId: string): Promise<PricedVenueLookupResult> {
  const resolved = await resolveVenueDetailId(requestedId);
  if (resolved.status !== "resolved") return resolved;
  const known = await lookupCanonicalVenue(resolved.id);
  if (known.status === "unavailable") return { status: "unavailable" };
  if (known.status === "unknown") return { status: "missing" };
  const base = await readVenueDetailBase(resolved.id, known.slimVenue);
  return base ? { status: "found", venue: base.venue } : { status: "unavailable" };
}

export function resetVenueDetailArtifactForTests(): void {
  if (!isTestRuntime()) return;
  cachedManifest = undefined;
  detailIndexFile = DEFAULT_DETAIL_INDEX_FILE;
  detailRowsFile = DEFAULT_DETAIL_ROWS_FILE;
  fallbackIndex = null;
  manifestReadAttemptsForTests = 0;
}

export function clearVenueDetailFallbackForTests(): void {
  if (!isTestRuntime()) return;
  fallbackIndex = null;
}

export function setVenueDetailArtifactFilesForTests(files: { indexFile?: string; rowsFile?: string }): void {
  if (!isTestRuntime()) return;
  if (files.indexFile !== undefined) {
    cachedManifest = undefined;
    detailIndexFile = files.indexFile;
  }
  if (files.rowsFile !== undefined) detailRowsFile = files.rowsFile;
}

export function getManifestReadAttemptsForTests(): number {
  return isTestRuntime() ? manifestReadAttemptsForTests : 0;
}
