// M3 — camera choreography constants + pure easing helpers. Kept dependency-free
// (no maplibre import) so they're trivially unit-testable and reusable from both
// useMapCamera and the click-routing module.

// Ease-out cubic: fast start, gentle settle — the "lean-in" feel for a pub
// selection fly-to. Pure function of t in [0, 1]; MapLibre calls this per frame.
export function easeOutCubic(t: number): number {
  const clamped = Math.min(Math.max(t, 0), 1);
  return 1 - Math.pow(1 - clamped, 3);
}

// Pub-select cinematic lean-in: 35-45deg pitch, 600-800ms, ease-out.
export const PUB_SELECT_PITCH = 40;
export const PUB_SELECT_DURATION_MS = 700;

// Long jumps (city switch, fit-London) fly with a pronounced arc — curve 1.42
// per the map-beauty PRD, applied to MapLibre's fitBounds/flyTo `curve` option.
export const LONG_JUMP_CURVE = 1.42;
