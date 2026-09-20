// Server read of the hyped-pubs pack, on the `lib/historic.ts` pattern.
//
// `/tonight` is prerendered, so this read happens at build and the rows ride in
// the document: no request, no client fetch, and the route's own byte ceiling
// in `perf/route-budgets.json` is untouched by a lane a reader may never see.
//
// The read is defensive on purpose. The file is published by
// `scripts/hyped-pubs-ingest.mjs` and can be absent on a fresh checkout, so a
// missing or malformed file answers with no rows and Tonight leads with the
// listings instead. A read that FAILED is never memoised.

import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";

import { EMPTY_HYPED_PUBS, parseHypedPubs, type HypedPubsFile } from "@/lib/hypedPubs";

const HYPED_PUBS_FILE = path.join(process.cwd(), "public", "data", "hyped", "london.json");

let cached: HypedPubsFile | null = null;

export async function loadHypedPubs(): Promise<HypedPubsFile> {
  if (cached) return cached;
  try {
    const raw = await readFile(HYPED_PUBS_FILE, "utf8");
    cached = parseHypedPubs(JSON.parse(raw));
  } catch {
    return EMPTY_HYPED_PUBS;
  }
  return cached;
}
