import "server-only";

import { allBoroughHeritageCounts } from "@/lib/boroughHeritage";
import { listBoroughs, type BoroughSummary } from "@/lib/boroughs";
import { loadHistoricPubs } from "@/lib/historic";
import { loadPintPriceLandingVenues } from "@/lib/pintPriceLandingDataset.server";

// The two derived tables the borough index page prints, each computed ONCE per
// process rather than once per request.
//
// Both are pure functions of bundled, build-time-constant data: the grouped
// price dataset (through the ONE governed seam, lib/pintPriceLandingDataset.server)
// and the cited Historic Pubs file. Neither carries anything about a viewer, so
// holding the derived answer is the same rule lib/venuePriceIndex already applies
// to the dataset it groups, and it is deliberately NOT the request-scoped lane
// lib/surfaceDataCache owns.
//
// WHY it is worth holding: /borough re-read and re-parsed 6.7 MB per request and
// then re-grouped and re-rolled it, which was the slowest server render in
// perf/route-budgets.json. The read and the grouping are gone through the shared
// seam; these two memos take the remaining per-request derivation off as well.
//
// A DEGRADED read is never cached. An empty list is what both loaders answer when
// they could not read, so caching one would turn a single failed render into a
// borough index that is empty for the life of the process.

let summaries: BoroughSummary[] | null = null;
let heritageCounts: ReadonlyMap<string, number> | null = null;

/** Every borough in the dataset, ordered by pub count (see listBoroughs). */
export async function getBoroughSummaries(): Promise<BoroughSummary[]> {
  if (summaries) return summaries;
  const venues = await loadPintPriceLandingVenues();
  const derived = listBoroughs(venues);
  if (derived.length === 0) return derived;
  summaries = derived;
  return summaries;
}

/** Borough slug → cited historic-pub count, for the index card's badge. */
export async function getBoroughHeritageCounts(): Promise<ReadonlyMap<string, number>> {
  if (heritageCounts) return heritageCounts;
  const pubs = await loadHistoricPubs();
  const derived = new Map(
    allBoroughHeritageCounts(pubs).map((borough) => [borough.slug, borough.count]),
  );
  if (derived.size === 0) return derived;
  heritageCounts = derived;
  return heritageCounts;
}

export function resetBoroughIndexForTests(): void {
  if (
    process.env.NODE_ENV === "test" ||
    Boolean(process.env.VITEST) ||
    Boolean(process.env.VITEST_WORKER_ID)
  ) {
    summaries = null;
    heritageCounts = null;
  }
}
