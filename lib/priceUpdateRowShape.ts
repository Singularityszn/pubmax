// Shared row guards for the four permissible price-update parsers
// (priceUpdates, drinkPriceUpdates, foodPriceUpdates, priceHistory).
// Imports nothing, so a parser can use a predicate without pulling a store.

/** A string with at least one character. Whitespace-only still counts. */
export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/**
 * A string with a non-whitespace character. priceHistory uses this: a blank
 * venue name or quote is not evidence.
 */
export function isNonBlankString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** A parseable ISO timestamp that is not after `now`. */
export function isValidObservedAt(value: unknown, now: number): value is string {
  if (!isNonEmptyString(value)) return false;
  const ms = Date.parse(value);
  return Number.isFinite(ms) && ms <= now;
}
