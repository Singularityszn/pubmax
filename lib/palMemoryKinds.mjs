// The closed vocabulary of Pub Pal memory kinds. Browser-safe and dependency-free,
// so a client parser and the agent script can check a kind without the Pal module.

export const PUB_PAL_MEMORY_KINDS = Object.freeze([
  "venue_preference",
  "atmosphere_preference",
  "accessibility_preference",
  "transport_preference",
  "drink_preference",
  "night_outcome",
  "correction",
]);

export function isPubPalMemoryKind(value) {
  return typeof value === "string" && PUB_PAL_MEMORY_KINDS.includes(value);
}
