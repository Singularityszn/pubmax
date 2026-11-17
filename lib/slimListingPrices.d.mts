import type { SlimVenue } from "./venuesSlim";
import type { UkPriceBundleRow } from "./ukPriceBundle";

export function applySlimListingPrices(slim: SlimVenue[], bundleRows: readonly UkPriceBundleRow[], now?: number): void;

export function compactFairPintPayload<T extends { fairPint?: readonly [unknown, unknown, unknown]; name?: string; borough?: string; priceSource?: string; priceObservedAt?: string }>(pins: readonly T[]): { rows: unknown[]; ft: number[]; fu?: string };
export function expandFairPintPin(value: unknown, metadata?: { ft?: unknown; fu?: unknown }): unknown;
