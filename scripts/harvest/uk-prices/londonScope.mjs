// Greater London scoping and menu-enrichment seeds for the document crawl lane.
// Kept beside run.mjs so the crawl CLI stays readable and the rules stay testable.

import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

import { inGreaterLondon } from "../../fetch_uk_osm_venues.mjs";
import { stableVenueIdFromKey, venueGroupingKey } from "../../lib/venueCanonicalization.mjs";
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

/**
 * Hosts that are never one pub's own site. The first is the aggregator the
 * curated dataset was itself extracted from; the rest are the third parties
 * run.mjs already declines to treat as a pub's site.
 */
const NOT_A_PUBS_OWN_HOST =
  /(^|\.)pint-prices\.com$|facebook|instagram|twitter|x\.com|tripadvisor|yelp|google|linktr\.ee|wixsite|whatpub/i;

/**
 * Rule 1 extended to the curated layer: a London curated venue's own `website`
 * field is a page that pub stated about itself, so it is DERIVED, not typed,
 * exactly as a snapshot `website` tag is. It joins the candidate hosts only
 * where the snapshot does not already carry that host, attached to the curated
 * venue's id, name and position so a ledger row names the pub it priced.
 *
 * Refused: a URL sourcePolicy will not read, an aggregator or social host, and
 * a host a source-table row names (a chain estate is argued for in that table
 * and read by its own lane, never as one pub's site).
 */
export function addCuratedLondonWebsiteHosts(
  hostEntries,
  { datasetRows, isHarvestableOperatorUrl, sourceTableHosts = [] },
) {
  const known = new Set(hostEntries.map((entry) => entry.host));
  const estateHosts = new Set(sourceTableHosts.map((host) => host.replace(/^www\./, "")));
  const added = new Map();
  const counts = { considered: 0, added: 0, hostsAdded: 0, alreadyCandidate: 0, refused: 0 };

  for (const row of datasetRows ?? []) {
    const lat = Number(row.latitude);
    const lng = Number(row.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !inGreaterLondon({ lat, lng })) continue;
    if (typeof row.website !== "string" || row.website.trim().length === 0) continue;
    counts.considered += 1;
    const website = row.website.includes("//") ? row.website.trim() : `https://${row.website.trim()}`;
    const host = hostOfWebsite(website);
    const estate = host !== null && [...estateHosts].some((known) => host === known || host.endsWith(`.${known}`));
    if (!host || !isHarvestableOperatorUrl(website) || NOT_A_PUBS_OWN_HOST.test(host) || estate) {
      counts.refused += 1;
      continue;
    }
    if (known.has(host)) {
      counts.alreadyCandidate += 1;
      continue;
    }
    const venueId = stableVenueIdFromKey(venueGroupingKey(row));
    const entry = added.get(host) ?? { host, origin: new URL(website).origin, pubs: [], seedPages: [] };
    if (entry.pubs.some((pub) => pub.venueId === venueId)) continue;
    // A website that names a page rather than a site root is that pub's own page
    // on a host that may serve several, so it is opened first.
    if (new URL(website).pathname.replace(/\/+$/, "") !== "" && !entry.seedPages.includes(website)) {
      entry.seedPages.push(website);
    }
    entry.pubs.push({
      venueId,
      osmId: null,
      name: row.pub_name ?? null,
      postcode: null,
      lat,
      lng,
      website,
    });
    added.set(host, entry);
    counts.added += 1;
  }

  for (const entry of added.values()) hostEntries.push(entry);
  counts.hostsAdded = added.size;
  return counts;
}
