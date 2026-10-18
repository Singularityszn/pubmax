// Which rows of the bundled pint dataset may be read as a price TODAY.
//
// A price recorded under an operator that has since left the pub is not
// evidence of today's price. Such a row stays in the dataset as dated history,
// marked `price_superseded`, and every reader skips it: the grouping in
// lib/venues.ts (Tonight, the venue sheet, the Pint Index, plan evidence), the
// /about numbers and the map pin builder in scripts/build_slim_index.mjs.
//
// Plain ESM with a .d.mts sidecar so the TypeScript app and the .mjs build
// scripts read ONE rule.
//
// A marker that is present but malformed still retires the row: the marker is
// a claim that the figure is stale, and a stale figure shown as live is the
// worse error. `priceSupersededErrors` names what is wrong with it so a data
// fence can fail loudly.
//
// A figure outside the pint band is not read as a price either. The harvest
// lanes already drop such a figure before it is written (`CATEGORY_PRICE_BANDS`
// in lib/harvest/ukPriceCrawl.ts, pinned equal to this band); the older
// Pint Prices lane never had that guard, and its £1.99 Bud Light rows led the
// cheapest-pint lists. Unlike a superseded row, an out-of-band row still tells
// the pub's story (its amenities, website and photo), because only the figure is
// in doubt, not the pub.

/**
 * The plausible price of a pint in a UK pub, in pounds. Below the floor is a
 * deal, a half or a typo; above the ceiling is a cocktail, a jug or a tab.
 */
export const PINT_PRICE_BAND_GBP = Object.freeze({ minGbp: 2, maxGbp: 12 });

export const PRICE_SUPERSEDED_REASONS = Object.freeze([
  // The operator that published the price left the pub: sold, closed or handed
  // to a new operator, on a day a public source states.
  "operator_change",
]);

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

function isIsoDay(value) {
  return typeof value === "string" && ISO_DAY.test(value) && !Number.isNaN(Date.parse(value));
}

/** True when the row carries a `price_superseded` marker of any shape. */
export function isSupersededPriceRow(row) {
  const marker = row?.price_superseded;
  return marker !== undefined && marker !== null;
}

/**
 * True when the row's figure sits outside the pint band. A row with no figure
 * is unpriced, not implausible, so it answers false.
 */
export function isOutOfBandPriceRow(row) {
  const price = row?.price_gbp;
  if (typeof price !== "number" || !Number.isFinite(price)) return false;
  return price < PINT_PRICE_BAND_GBP.minGbp || price > PINT_PRICE_BAND_GBP.maxGbp;
}

/** True when the row may tell the pub's story: its amenities, website and photo. */
export function isCurrentVenueRow(row) {
  return !isSupersededPriceRow(row);
}

/** True when the row may be read as a price today. */
export function isLivePriceRow(row) {
  return isCurrentVenueRow(row) && !isOutOfBandPriceRow(row);
}

/** Every problem with a row's `price_superseded` marker; empty when it is sound or absent. */
export function priceSupersededErrors(row) {
  if (!isSupersededPriceRow(row)) return [];
  const marker = row.price_superseded;
  if (typeof marker !== "object" || Array.isArray(marker)) {
    return ["price_superseded must be an object"];
  }
  const errors = [];
  if (!PRICE_SUPERSEDED_REASONS.includes(marker.reason)) {
    errors.push(`price_superseded.reason must be one of ${PRICE_SUPERSEDED_REASONS.join(", ")}`);
  }
  if (typeof marker.operator !== "string" || !marker.operator.trim()) {
    errors.push("price_superseded.operator must name the operator that left");
  }
  if (!isIsoDay(marker.left_on)) {
    errors.push("price_superseded.left_on must be the YYYY-MM-DD day a source states the operator left");
  }
  if (typeof marker.evidence !== "string" || !marker.evidence.trim()) {
    errors.push("price_superseded.evidence must say what the sources state");
  }
  if (
    !Array.isArray(marker.evidence_urls) ||
    marker.evidence_urls.length === 0 ||
    !marker.evidence_urls.every((url) => typeof url === "string" && url.startsWith("https://"))
  ) {
    errors.push("price_superseded.evidence_urls must be one or more https URLs");
  }
  if (!isIsoDay(marker.recorded_on)) {
    errors.push("price_superseded.recorded_on must be the YYYY-MM-DD day the marker was written");
  }
  return errors;
}
