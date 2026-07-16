// Server-only loader for the grouped London venue set — the shared read path
// behind the Pint Index page and its CSV export (Wave S3.3). Mirrors the same
// bundled dataset the borough/sitemap surfaces read, grouped to Venue[] via the
// canonical grouping. Never throws: a read/parse failure yields [] so the Pint
// Index degrades to an honest empty state rather than 500-ing.

import { groupVenuePrices, type Venue, type VenuePrice } from "@/lib/venues";
import { PINT_DATASET_FILE } from "@/lib/dataFreshness";

export async function loadGroupedVenues(): Promise<Venue[]> {
  try {
    const { promises: fs } = await import("node:fs");
    const path = await import("node:path");
    const file = path.join(process.cwd(), "public", "data", PINT_DATASET_FILE);
    const rows = JSON.parse(await fs.readFile(file, "utf8")) as VenuePrice[];
    return groupVenuePrices(Array.isArray(rows) ? rows : []);
  } catch {
    return [];
  }
}
