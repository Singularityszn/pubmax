import "server-only";

import { promises as fs } from "fs";
import path from "path";
import { computePublicPriceStats } from "@/lib/publicPriceStats";
import type { VenuePrice } from "@/lib/venues";

let cached: Promise<ReturnType<typeof computePublicPriceStats>> | null = null;

/** Both public loaders share one bundled read, including concurrent requests. */
export function loadPublicPriceStats() {
  cached ??= readPublicPriceStats().catch((error) => {
    cached = null;
    throw error;
  });
  return cached;
}

async function readPublicPriceStats() {
  // Propagate failures so each public loader can discard its failed promise.
  // An empty success would otherwise stay cached by the first page to read it.
  const file = path.join(/* turbopackIgnore: true */ process.cwd(), "public", "data", "pint_prices_app_dataset.json");
  const rows = JSON.parse(await fs.readFile(/* turbopackIgnore: true */ file, "utf8")) as VenuePrice[];
  return computePublicPriceStats(rows);
}

export function resetPublicPriceStatsForTests(): void {
  if (process.env.NODE_ENV === "test" || process.env.VITEST || process.env.VITEST_WORKER_ID) {
    cached = null;
  }
}
