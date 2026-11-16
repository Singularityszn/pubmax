// Leaf GBP formatter — no imports, so a browser bundle that only needs the
// price string never pulls the venue index in behind it.

/** GBP formatter for prices, e.g. 5.4 → "£5.40". */
export function formatGbp(value: number): string {
  return `£${value.toFixed(2)}`;
}

/** Whole pence as pounds and pence, e.g. 3100 → "£31.00". */
export function formatPence(pence: number): string {
  return formatGbp(pence / 100);
}
