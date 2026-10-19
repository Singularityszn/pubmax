import "server-only";

import type { CityId } from "@/lib/cities";
import { formatPintDatasetSnapshot } from "@/lib/dataFreshness";

/**
 * The loading screens' freshness line for one city's map, built on the server.
 * It dates the bundled London pint snapshot and nothing more: Pint Drops and
 * sourced menu rows carry their own, sometimes newer, dates, so calling this day
 * the newest price would understate them. The snapshot words come from their
 * one owner, `formatSnapshotFrom` (lib/AGENTS.md, freshness), in the shape
 * `TodayPintsCard` already gives a scoped snapshot.
 *
 * Only London's map reads that snapshot, so every other city gets null. `/map`,
 * `/map/london` and the London `/map/arrival` all come here, so one London route
 * cannot drop the line while another prints it (Codex on #2276).
 */
export function mapPricesReadLineFor(cityId: CityId): string | null {
  return cityId === "london" ? `London pint prices. ${formatPintDatasetSnapshot()}.` : null;
}
