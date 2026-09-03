// The shipped estimate basis, read once.
//
// A STATIC IMPORT ON PURPOSE. A route that assembles a data path at request
// time ships without its data unless `next.config.mjs` is told about it
// (AGENTS.md, the runtime-pack law), and this table is a few kilobytes. Naming
// the file in an import means Next traces it, no tracing key is needed and the
// file cannot go missing from a deployed function.
//
// The table is DATA the build script wrote, so it is validated on the way in
// rather than trusted: a malformed artifact answers null and the surfaces above
// say they could not read the basis, which is a different sentence from saying
// the basis is empty.

import baselines from "@/public/data/price_estimates/baselines.json";
import {
  isEstimateBaselines,
  type EstimateBaselines,
} from "@/lib/priceEstimate";

let cached: EstimateBaselines | null | undefined;

/** The basis, or null when the shipped artifact does not survive its own validator. */
export function estimateBaselines(): EstimateBaselines | null {
  if (cached === undefined) {
    cached = isEstimateBaselines(baselines) ? (baselines as EstimateBaselines) : null;
  }
  return cached;
}
