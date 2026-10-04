export const PUB_PAL_MEMORY_KINDS: readonly [
  "venue_preference",
  "atmosphere_preference",
  "accessibility_preference",
  "transport_preference",
  "drink_preference",
  "night_outcome",
  "correction",
];
export type PubPalMemoryKind = (typeof PUB_PAL_MEMORY_KINDS)[number];
export function isPubPalMemoryKind(value: unknown): value is PubPalMemoryKind;
