// Server-only: join enrichment overlay + dataset into ScrapedPub[].
// Import from Server Components / route handlers only — uses node:fs.

import { readFile } from "node:fs/promises";
import path from "node:path";

import { loadVenueMenuEnrichmentIndex } from "@/lib/venueMenuEnrichment";
import { directVenueImageUrl } from "@/lib/venueImages";
import { groupVenuePrices, type VenuePrice } from "@/lib/venues";
import {
  drinkAccentForVenue,
  drinkShelfForVenue,
  normaliseScrapedSource,
  SCRAPED_SOURCE_LABELS,
  type ScrapedPub,
  type ScrapedPubSourceId,
} from "@/lib/scrapedPubs";

async function loadGroupedVenues() {
  try {
    const file = path.join(
      process.cwd(),
      "public",
      "data",
      "pint_prices_app_dataset.json",
    );
    const rows = JSON.parse(await readFile(file, "utf8")) as VenuePrice[];
    return groupVenuePrices(Array.isArray(rows) ? rows : []);
  } catch {
    return [];
  }
}

/** All scraped enrichment pubs, newest sources first within name sort. */
export async function listScrapedPubs(): Promise<ScrapedPub[]> {
  const [index, venues] = await Promise.all([
    loadVenueMenuEnrichmentIndex(),
    loadGroupedVenues(),
  ]);
  const byId = new Map(venues.map((venue) => [venue.id, venue]));
  const pubs: ScrapedPub[] = [];

  for (const [id, record] of index.entries()) {
    const venue = byId.get(id);
    const source = normaliseScrapedSource(record.source);
    const drinkAccent = drinkAccentForVenue(id);
    const tilePhoto = record.categoryTiles?.find((tile) => tile.imageUrl)?.imageUrl;
    const venuePhoto = venue ? directVenueImageUrl(venue.imageUrl) : "";
    const photoUrl = directVenueImageUrl(tilePhoto ?? "") || venuePhoto || undefined;

    pubs.push({
      id,
      name: venue?.name ?? id,
      borough: venue?.primaryBorough ?? "",
      source,
      sourceLabel: SCRAPED_SOURCE_LABELS[source],
      menuUrl: record.menuUrl,
      bookingUrl: record.bookingUrl,
      photoUrl,
      drinkAccent,
      drinkShelf: drinkShelfForVenue(id, drinkAccent),
      cheapestPrice: venue?.cheapestPrice ?? null,
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
