export function comparablePint(input?: {
  cheapestPrice?: unknown;
  priceSource?: unknown;
  priceObservedAt?: unknown;
  anchorLabel?: unknown;
  measure?: unknown;
  cheapestPint?: unknown;
}, now?: number): number | null;
export function pintObservationTime(value: unknown, now?: number): number | null;
export function isComparablePintServing(input?: { measure?: unknown; cheapestPint?: unknown }): boolean;
