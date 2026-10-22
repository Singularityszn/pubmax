// Leaf GBP formatter — no imports, so a browser bundle that only needs the
// price string never pulls the venue index in behind it.

/** GBP formatter for prices, e.g. 5.4 → "£5.40". */
export function formatGbp(value: number): string {
  return `£${value.toFixed(2)}`;
}

/** A price figure, or the existing placeholder when none was recorded. */
export function formatPrice(value: number | null): string {
  return typeof value === "number" ? formatGbp(value) : "No price";
}
