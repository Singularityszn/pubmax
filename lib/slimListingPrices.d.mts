import type { SlimVenue } from "./venuesSlim";
import type { UkPriceBundleRow } from "./ukPriceBundle";

export function applySlimListingPrices(slim: SlimVenue[], bundleRows: readonly UkPriceBundleRow[], now?: number): void;
