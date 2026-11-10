import type { PalRecommendationPoint } from "@/lib/palRecommendationMap";

// What the voice Pal may ask the main map to show. A pure leaf with no SDK: the
// voice call writes here and the map canvas reads. The vocabulary is closed,
// and every pub must come from the call's own grounded tool result, so a
// model's guess can never become a pin.

export const PAL_MAP_MAX_PICKS = 6;

export type PalMapPick = PalRecommendationPoint;

export type PalMapCommand =
  | { kind: "showPicks"; picks: readonly PalMapPick[] }
  | { kind: "focusPick"; number: number | null }
  | { kind: "clear" };

export type PalMapState = {
  /** Rises on every accepted command, so a reader can tell a new answer from a repaint. */
  sequence: number;
  picks: readonly PalMapPick[];
  /** The pick the Pal is naming. A change here keeps `sequence`, so the map does not reframe. */
  focused: number | null;
};

let grounded: ReadonlySet<string> = new Set();
let state: PalMapState = { sequence: 0, picks: [], focused: null };
const listeners = new Set<() => void>();

function notify(next: PalMapState): void {
  state = next;
  for (const listener of listeners) listener();
}

function publish(picks: readonly PalMapPick[]): void {
  notify({ sequence: state.sequence + 1, picks, focused: null });
}

export function readPalMapState(): PalMapState {
  return state;
}

export function subscribePalMapState(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The venues the newest grounded tool result named. Only these may become picks. */
export function groundPalMapResult(venueIds: readonly string[]): void {
  grounded = new Set(venueIds.filter(Boolean));
  const picks = state.picks.filter((pick) => grounded.has(pick.venueId));
  if (picks.length !== state.picks.length) {
    publish(picks.map((pick, index) => ({ ...pick, number: index + 1 })));
  }
}

/** Apply one command. Returns false, and changes nothing, when it is refused. */
export function applyPalMapCommand(command: PalMapCommand): boolean {
  if (command.kind === "clear") {
    if (state.picks.length) publish([]);
    return true;
  }
  if (command.kind === "focusPick") {
    if (command.number !== null && !state.picks.some((pick) => pick.number === command.number)) return false;
    if (command.number !== null || command.number !== state.focused) notify({ ...state, focused: command.number });
    return true;
  }
  const picks = command.picks.slice(0, PAL_MAP_MAX_PICKS);
  if (picks.some((pick) => !grounded.has(pick.venueId))) return false;
  if (new Set(picks.map((pick) => pick.venueId)).size !== picks.length) return false;
  publish(picks.map((pick, index) => ({ ...pick, number: index + 1 })));
  return true;
}

/** The call is over: forget its grounded pubs and take its picks off the map. */
export function resetPalMap(): void {
  grounded = new Set();
  applyPalMapCommand({ kind: "clear" });
}
