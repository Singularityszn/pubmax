import "server-only";

// Server-only allowlist of image hosts the /api/image-proxy may fetch (U4).
//
// A public proxy that fetches arbitrary hostnames is an SSRF primitive, and
// every allowed host can put a picture of its choice on the app's address. So
// the proxy only fetches hosts named in a PHOTO field of the app's own
// committed datasets, read through a real JSON parse. Link fields and free
// text are never scanned: they name ordinary websites, and truncated text can
// yield a host nobody has registered.
//
// Built lazily once per process from the same data files the UI reads.

import fs from "node:fs";
import path from "node:path";

import {
  VENUE_IMAGE_HOST_PHOTO_FIELD_FILE,
  VENUE_IMAGE_HOST_TILE_PHOTO_FILE,
} from "@/lib/venueImageHostFiles.mjs";

let cached: Set<string> | null = null;

function hostnameOf(url: unknown): string | null {
  if (typeof url !== "string" || !url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return null;
    return parsed.hostname.toLowerCase();
  } catch {
    return null;
  }
}

function readJson(rel: string): unknown {
  try {
    return JSON.parse(
      fs.readFileSync(path.join(/* turbopackIgnore: true */ process.cwd(), rel), "utf8"),
    );
  } catch {
    // A missing or malformed data file contributes no hosts. Fail closed.
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

/** venue.imageUrl: one `image_url` per pint-price row. */
function pintPhotoUrls(data: unknown): unknown[] {
  return Array.isArray(data) ? data.map((row) => (isRecord(row) ? row.image_url : null)) : [];
}

/** The /pubs card photo: `venues.<id>.categoryTiles[].imageUrl`. */
function tilePhotoUrls(data: unknown): unknown[] {
  if (!isRecord(data) || !isRecord(data.venues)) return [];
  return Object.values(data.venues).flatMap((venue) =>
    isRecord(venue) && Array.isArray(venue.categoryTiles)
      ? venue.categoryTiles.map((tile) => (isRecord(tile) ? tile.imageUrl : null))
      : [],
  );
}

export function allowedVenueImageHosts(): Set<string> {
  if (cached) return cached;
  const hosts = new Set<string>();
  for (const url of [
    ...pintPhotoUrls(readJson(VENUE_IMAGE_HOST_PHOTO_FIELD_FILE)),
    ...tilePhotoUrls(readJson(VENUE_IMAGE_HOST_TILE_PHOTO_FILE)),
  ]) {
    const host = hostnameOf(url);
    if (host) hosts.add(host);
  }
  cached = hosts;
  return hosts;
}

/** Test-only: reset the memoised host set. */
export function __resetVenueImageHosts(): void {
  cached = null;
}
