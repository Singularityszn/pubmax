// Server-only: join enrichment overlay + dataset into ScrapedPub[].
// Import from Server Components / route handlers only — uses node:fs.

import { readFile } from "node:fs/promises";
import path from "node:path";

import { loadVenueMenuEnrichmentIndex } from "@/lib/venueMenuEnrichment";
import { proxiedVenueImageUrl } from "@/lib/venueImages";
import { firstHttp } from "@/lib/httpUrl";
import { getPricedVenues } from "@/lib/venuePriceIndex";
import {
  drinkAccentForVenue,
  drinkShelfForVenue,
  normaliseScrapedSource,
  SCRAPED_SOURCE_LABELS,
  type ScrapedPub,
  type ScrapedPubSourceId,
} from "@/lib/scrapedPubs";

/** id → nearest-station fare zone, from the slim index (single source of truth). */
async function loadZonesById(): Promise<Map<string, number>> {
  const byId = new Map<string, number>();
  try {
    const file = path.join(process.cwd(), "public", "data", "venues_slim.json");
    const rows = JSON.parse(await readFile(file, "utf8")) as unknown;
    if (Array.isArray(rows)) {
      for (const row of rows as { id?: unknown; zone?: unknown }[]) {
        if (typeof row.id === "string" && typeof row.zone === "number" && Number.isInteger(row.zone)) {
          byId.set(row.id, row.zone);
        }
      }
    }
  } catch {
    // No slim index → every scraped pub reads zone: null (honestly unknown).
  }
  return byId;
}

/** All scraped enrichment pubs, newest sources first within name sort. */
async function readScrapedPubs(): Promise<ScrapedPub[]> {
  const [index, venues, zonesById] = await Promise.all([
    loadVenueMenuEnrichmentIndex(),
    // The SHARED priced-venue index rather than a second parse of the same
    // 6.7 MB file: lib/venuePriceIndex.ts already holds exactly this grouping
    // for every other surface that needs it.
    getPricedVenues(),
    loadZonesById(),
  ]);
  const byId = new Map(venues.map((venue) => [venue.id, venue]));
  const pubs: ScrapedPub[] = [];

  for (const [id, record] of index.entries()) {
    const venue = byId.get(id);
    const source = normaliseScrapedSource(record.source);
    const drinkAccent = drinkAccentForVenue(id);
    const tilePhoto = record.categoryTiles?.find((tile) => tile.imageUrl)?.imageUrl;
    const venuePhoto = venue ? proxiedVenueImageUrl(venue.imageUrl) : "";
    const photoUrl = proxiedVenueImageUrl(tilePhoto ?? "") || venuePhoto || undefined;

    pubs.push({
      id,
      name: venue?.name ?? id,
      borough: venue?.primaryBorough ?? "",
      source,
      sourceLabel: SCRAPED_SOURCE_LABELS[source],
      // Scheme-guard before the value reaches PubsGallery as an href — a
      // javascript:/data: menuUrl would otherwise be an XSS vector. firstHttp
      // returns "" for anything that isn't an absolute http(s) URL, so drop
      // the field entirely in that case.
      menuUrl: firstHttp(record.menuUrl) || undefined,
      bookingUrl: firstHttp(record.bookingUrl) || undefined,
      photoUrl,
      drinkAccent,
      drinkShelf: drinkShelfForVenue(id, drinkAccent),
      cheapestPrice: venue?.cheapestPrice ?? null,
      zone: zonesById.get(id) ?? null,
    });
  }

  const sourceRank: Record<ScrapedPubSourceId, number> = {
    "nicholsonspubs.co.uk": 0,
    "youngs.co.uk": 1,
    "greene-king.co.uk": 2,
    other: 3,
  };

  pubs.sort((a, b) => {
    const bySource = sourceRank[a.source] - sourceRank[b.source];
    if (bySource !== 0) return bySource;
    return a.name.localeCompare(b.name);
  });

  return pubs;
}

// Every input above is a file bundled with the deployment, so the answer cannot
// change between two requests to the same instance. /pubs is on the per-request
// render path (the CSP nonce keeps every route dynamic), and the price read
// alone is a 6.7 MB JSON.parse — so an unmemoized loader charged that parse to
// every single view of the page, which measured as a ~170 ms server render
// against a ~10 ms one everywhere else. Same shape as loadAboutStats(), which
// solved the same problem for the landing figures: hold the PROMISE, not the
// value, so concurrent first requests share one read instead of racing several,
// and the large intermediates are collected once the small result is built.
let cachedPubs: Promise<ScrapedPub[]> | null = null;

/** All scraped enrichment pubs, read once per instance. */
export function listScrapedPubs(): Promise<ScrapedPub[]> {
  // A rejection must not be remembered: every read above is already fail-soft,
  // so a throw here means something unexpected and the next request deserves a
  // fresh attempt rather than a permanently empty page.
  cachedPubs ??= readScrapedPubs().catch((error) => {
    cachedPubs = null;
    throw error;
  });
  return cachedPubs;
}

