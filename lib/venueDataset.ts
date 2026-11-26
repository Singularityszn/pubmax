// Server-only loader for the grouped London venue set — the shared read path
// behind the Pint Index page and its CSV export (Wave S3.3). Mirrors the same
// bundled dataset the borough/sitemap surfaces read, grouped to Venue[] via the
// canonical grouping. Never throws: a read/parse failure yields [] so the Pint
// Index degrades to an honest empty state rather than 500-ing.

import "server-only";

import type { Venue } from "@/lib/venues";
import { getPricedVenues } from "@/lib/venuePriceIndex";

export async function loadGroupedVenues(): Promise<Venue[]> {
  try {
    return await getPricedVenues();
  } catch {
    return [];
  }
}
