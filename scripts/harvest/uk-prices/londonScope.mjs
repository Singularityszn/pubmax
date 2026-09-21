// Greater London scoping and menu-enrichment seeds for the document crawl lane.
// Kept beside run.mjs so the crawl CLI stays readable and the rules stay testable.

import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

import { inGreaterLondon } from "../../fetch_uk_osm_venues.mjs";
const DEFAULT_ENRICHMENT = path.join("public", "data", "venue_menu_enrichment.json");
const DEFAULT_VENUES_SLIM = path.join("public", "data", "venues_slim.json");

export function hostOfWebsite(website) {
  try {
    const url = new URL(website.includes("//") ? website : `https://${website}`);
    return url.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** Drop pubs outside Greater London and remove hosts with no pubs left. */
export function filterHostEntriesToGreaterLondon(hostEntries) {
  const kept = [];
  for (const entry of hostEntries) {
    const pubs = (entry.pubs ?? []).filter((pub) =>
      typeof pub.lat === "number" &&
      typeof pub.lng === "number" &&
      inGreaterLondon(pub),
    );
    if (pubs.length === 0) continue;
    kept.push({ ...entry, pubs });
  }
  return kept;
}

/** venue id → { lat, lng } from the shipped slim index. */
export function venueCoordsFromSlim(filePath = DEFAULT_VENUES_SLIM) {
  if (!existsSync(filePath)) return new Map();
  const slim = JSON.parse(readFileSync(filePath, "utf8"));
  const coords = new Map();
  for (const row of slim.rows ?? []) {
    if (typeof row.id !== "string") continue;
    if (typeof row.lat !== "number" || typeof row.lng !== "number") continue;
    coords.set(row.id, { lat: row.lat, lng: row.lng });
  }
  return coords;
}

function drinkishMenuUrlScore(url) {
  try {
    const { pathname } = new URL(url);
    if (/(drink|cocktail|spirit|wine|beer|gin|whisky|menu|food-and-drink)/i.test(pathname)) {
      return 0;
    }
    return 1;
  } catch {
    return 2;
  }
}

/**
 * Seed per-pub menu pages from venue_menu_enrichment onto crawl host rows.
 * Only London venues; every URL is policy-checked by the caller.
 */
export function applyMenuEnrichmentSeeds(
  hostEntries,
  {
    enrichmentPath = DEFAULT_ENRICHMENT,
    coordsByVenueId,
    isHarvestableOperatorUrl,
  },
) {
  if (!existsSync(enrichmentPath)) {
    return { seeded: 0, venuesConsidered: 0, onUnknownHost: 0, refused: 0 };
  }
  const enrichment = JSON.parse(readFileSync(enrichmentPath, "utf8"));
  const venues = enrichment.venues ?? {};
  let seeded = 0;
  let venuesConsidered = 0;
  let onUnknownHost = 0;
  let refused = 0;

  for (const [venueId, row] of Object.entries(venues)) {
    const coords = coordsByVenueId.get(venueId);
    if (!coords || !inGreaterLondon(coords)) continue;
    venuesConsidered += 1;

    const rawUrls = [];
    if (typeof row.menuUrl === "string" && row.menuUrl.trim().length > 0) {
      rawUrls.push(row.menuUrl.trim());
    }
    for (const tile of row.categoryTiles ?? []) {
      if (typeof tile.href === "string" && tile.href.trim().length > 0) {
        rawUrls.push(tile.href.trim());
      }
    }

    const urls = [...new Set(rawUrls)].sort(
      (a, b) => drinkishMenuUrlScore(a) - drinkishMenuUrlScore(b),
    );

    for (const url of urls) {
      const normalised = url.includes("//") ? url : `https://${url}`;
      if (!isHarvestableOperatorUrl(normalised)) {
        refused += 1;
        continue;
      }
      const host = hostOfWebsite(normalised);
      if (!host) continue;
      const entry = hostEntries.find((known) => known.host === host);
      if (!entry) {
        onUnknownHost += 1;
        continue;
      }
      entry.seedPages = entry.seedPages ?? [];
      if (!entry.seedPages.includes(normalised)) {
        entry.seedPages.push(normalised);
        seeded += 1;
      }
    }
  }

  return { seeded, venuesConsidered, onUnknownHost, refused };
}
