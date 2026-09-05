// A venue named here is proven NOT a drinking establishment (a department
// store, a museum, a hotel lobby with no bar, ...) yet its name and address
// still sit in a scraped price source, so nothing upstream can tell it apart
// from a real pub on name alone. `data/priced_index_excluded_venues.json` is
// the closed, hand-curated list of rows that must never re-enter the priced
// near-you rail: scripts/validate-data.mjs fails the build if one comes back.
//
// Plain-JS, dependency-free, so both the build validator and its test can
// share one normaliser rather than drifting apart.

const EXCLUSIONS_FILE_RELATIVE = "data/priced_index_excluded_venues.json";

function normalise(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function excludedPricedVenueKey(entry) {
  return `${normalise(entry?.name)}|${normalise(entry?.address)}`;
}

export function pricedRowExclusionMatch(row, exclusions) {
  const rowKey = excludedPricedVenueKey({
    name: row?.pub_name,
    address: row?.address,
  });
  return exclusions.find((entry) => excludedPricedVenueKey(entry) === rowKey) ?? null;
}

export function findExcludedPricedRows(rows, exclusions) {
  const found = [];
  rows.forEach((row, index) => {
    const match = pricedRowExclusionMatch(row, exclusions);
    if (match) {
      found.push({ index, row, exclusion: match });
    }
  });
  return found;
}

export function isValidExclusionEntry(entry) {
  return (
    typeof entry === "object" &&
    entry !== null &&
    typeof entry.name === "string" &&
    entry.name.trim().length > 0 &&
    typeof entry.address === "string" &&
    entry.address.trim().length > 0 &&
    typeof entry.reason === "string" &&
    entry.reason.trim().length > 0
  );
}

export const PRICED_INDEX_EXCLUSIONS_FILE = EXCLUSIONS_FILE_RELATIVE;
