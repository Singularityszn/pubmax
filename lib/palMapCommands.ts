import type { PalRecommendationPoint } from "@/lib/palRecommendationMap";

// What the voice Pal may ask the main map to show. A pure leaf with no SDK: the
// voice call writes here and the map canvas reads. The vocabulary is closed,
// and every pub must come from the call's own grounded tool result, so a
// model's guess can never become a pin.

export const PAL_MAP_MAX_PICKS = 6;

export type PalMapPick = PalRecommendationPoint;

export type PalMapCommand =
  | { kind: "showPicks"; picks: readonly PalMapPick[] }
  /** `move` also brings the pick into view: the person asked for it by number. */
  | { kind: "focusPick"; number: number | null; move?: boolean }
  /** The area comes from the closed night-area list, never from the model. */
  | { kind: "flyToArea"; centre: { lat: number; lng: number }; radiusKm: number }
  | { kind: "clear" };

/** A camera move the person asked for. The map frames these points once. */
export type PalMapView = { sequence: number; points: readonly { lat: number; lng: number }[] };

export type PalMapState = {
  /** Rises when picks are published or cleared, so readers can identify a new answer. */
  sequence: number;
  picks: readonly PalMapPick[];
  /** The pick the Pal is naming. A change here keeps `sequence`, so the map does not reframe. */
  focused: number | null;
  /** The newest asked-for move. It shares the counter with `sequence`, so the later of the two wins. */
  view: PalMapView | null;
};

const KM_PER_DEGREE = 111.32;

let grounded: ReadonlySet<string> = new Set();
let revision = 0;
let state: PalMapState = { sequence: 0, picks: [], focused: null, view: null };
const listeners = new Set<() => void>();

function notify(next: PalMapState): void {
  state = next;
  for (const listener of listeners) listener();
}

function publish(picks: readonly PalMapPick[]): void {
  notify({ ...state, sequence: ++revision, picks, focused: null });
}

function moveTo(points: PalMapView["points"]): PalMapView {
  return { sequence: ++revision, points };
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
    const pick = state.picks.find((item) => item.number === command.number);
    if (command.number !== null && !pick) return false;
    const view = pick && command.move ? moveTo([{ lat: pick.lat, lng: pick.lng }]) : state.view;
    if (command.number !== null || command.number !== state.focused) notify({ ...state, focused: command.number, view });
    return true;
  }
  if (command.kind === "flyToArea") {
    const { centre, radiusKm } = command;
    const lat = radiusKm / KM_PER_DEGREE;
    const lng = radiusKm / (KM_PER_DEGREE * Math.cos((centre.lat * Math.PI) / 180));
    notify({ ...state, view: moveTo([
      { lat: centre.lat - lat, lng: centre.lng - lng },
      { lat: centre.lat + lat, lng: centre.lng + lng },
    ]) });
    return true;
  }
  const picks = command.picks.slice(0, PAL_MAP_MAX_PICKS);
  if (picks.some((pick) => !grounded.has(pick.venueId))) return false;
  if (new Set(picks.map((pick) => pick.venueId)).size !== picks.length) return false;
  publish(picks.map((pick, index) => ({ ...pick, number: index + 1 })));
  return true;
}

/**
 * The call is over: forget its grounded pubs and take its picks and its last
 * move off the map. A new sequence, even with no picks, releases the Pal's
 * hold on the camera, so a move still queued cannot land after the call.
 */
export function resetPalMap(): void {
  grounded = new Set();
  if (state.picks.length || state.view) notify({ sequence: ++revision, picks: [], focused: null, view: null });
}
