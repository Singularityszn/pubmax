import "server-only";

import { promises as fs } from "node:fs";
import path from "node:path";

import { mergePriceUpdates, parsePriceUpdates, type VenuePintPriceRefresh } from "@/lib/priceUpdates";
import { isValidObservedAt } from "@/lib/priceUpdateRowShape";
import { venueUpdateKey } from "@/lib/pubMap";
import { authoritativeBundleRows, BUNDLE_DEFAULT_CATEGORY, bundlePricesForCategory } from "@/lib/ukPriceBundle";
import { ukPriceBundleRowsFor } from "@/lib/ukPriceBundle.server";
import type { Venue } from "@/lib/venues";

/** The sheet and Ledger read the same published inputs, including failed reads. */
export async function readVenuePintPriceEvidence(venue: Venue) {
  const [bundle, updates] = await Promise.all([
    ukPriceBundleRowsFor(venue.id),
    readPintPriceUpdates(),
  ]);
  const pricedVenue = mergePriceUpdates([venue], updates ?? [], venueUpdateKey)[0] ?? { ...venue, sourcedPrice: null };
  const now = Date.now();
  const rows = bundle.rows.filter((row) => isValidObservedAt(row.observedAt, now));
  const bundlePrices = bundle.status === "unavailable"
    ? null : bundlePricesForCategory(rows, BUNDLE_DEFAULT_CATEGORY);
  const listed = bundlePrices?.listed;
  const listedRow = listed ? authoritativeBundleRows(rows).find((row) =>
    row.category === BUNDLE_DEFAULT_CATEGORY && row.standing === "listed"
      && row.priceGbp === listed.priceGbp && row.sourceUrl === listed.sourceUrl
      && row.observedAt === listed.observedAt,
  ) : null;
  return {
    venue: pricedVenue,
    pintPriceRefresh: {
      status: updates === null ? "unavailable" : "ready",
      update: updates?.find((update) => update.venueKey === venueUpdateKey(venue)) ?? null,
    } satisfies VenuePintPriceRefresh,
    bundlePrices,
    listedRow,
    reads: { bundle: bundle.status, sourced: updates === null ? "unavailable" as const : "ready" as const },
  };
}

async function readPintPriceUpdates() {
  try {
    const file = path.join(process.cwd(), "public", "data", "price_updates", "latest.json");
    // This small refresh file follows the map's parser and is read afresh.
    /* turbopackIgnore: true */
    return parsePriceUpdates(JSON.parse(await fs.readFile(file, "utf8")));
  } catch {
    return null;
  }
}
