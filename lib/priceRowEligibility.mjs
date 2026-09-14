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

export const PRICE_SUPERSEDED_REASONS = Object.freeze([
  // The operator that published the price left the pub: sold, closed or handed
  // to a new operator, on a day a public source states.
  "operator_change",
  // The chain withdrew the pub from its own directory and pub page, and no
  // public source yet states that it changed hands or when.
  "chain_withdrew",
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

/** True when the row may be read as a price today. */
export function isLivePriceRow(row) {
  return !isSupersededPriceRow(row);
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
  if (marker.reason === "operator_change" && !isIsoDay(marker.left_on)) {
    errors.push("price_superseded.left_on must be the YYYY-MM-DD day a source states for an operator_change");
  }
  if (marker.reason === "chain_withdrew" && marker.left_on !== null) {
    errors.push("price_superseded.left_on must be null for chain_withdrew: no source states the day");
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
