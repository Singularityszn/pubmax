import { readFileSync } from "node:fs";
import { buildVenueResolverIndex } from "./resolveVenueId.mjs";

/** Load the canonical dataset for a refresh, then build the shared resolver index. */
export function loadCanonicalVenueIndex() {
  const rows = JSON.parse(readFileSync(new URL("../../public/data/pint_prices_app_dataset.json", import.meta.url), "utf8"));
  return buildVenueResolverIndex(Array.isArray(rows) ? rows : []);
}
