import {
  PUBMAX_SELECTION_SENTINEL,
  withSelectionSentinel,
} from "@/lib/mapSelectionHistory";
import {
  MAX_SURFACE_DEPTH,
  openSurface,
  type SurfaceEntry,
  type SurfaceStack,
} from "@/lib/surfaceStack";

export const MAP_SURFACE_HISTORY_KEY = "pubmaxMapSurface";
const LEGACY_SURFACE_HISTORY_KEY = "pubmaxSurfaceDepth";
const MAP_SURFACE_HISTORY_VERSION = 1 as const;

type MapSurfaceHistory<S> = {
  version: typeof MAP_SURFACE_HISTORY_VERSION;
  stack: SurfaceStack<S>;
  /**
   * Browser entries between this one and the Map root. It equals the stack
   * depth until a reopened parent is pushed again over a shorter trail.
   */
  aboveRoot: number;
};

function historyStateRecord(state: unknown): Record<string, unknown> {
  return state && typeof state === "object"
    ? { ...(state as Record<string, unknown>) }
    : {};
}

function isSurfaceEntry(value: unknown): value is SurfaceEntry<unknown> {
  if (!value || typeof value !== "object") return false;
  const entry = value as { id?: unknown; title?: unknown };
  return typeof entry.id === "string" && typeof entry.title === "string";
}

export function readMapSurfaceHistory<S>(state: unknown): SurfaceStack<S> | null {
  if (!state || typeof state !== "object") return null;
  const raw = (state as Record<string, unknown>)[MAP_SURFACE_HISTORY_KEY];
  if (!raw || typeof raw !== "object") return null;
  const snapshot = raw as { version?: unknown; stack?: unknown };
  if (snapshot.version !== MAP_SURFACE_HISTORY_VERSION) return null;
  if (!Array.isArray(snapshot.stack)) return null;
  if (snapshot.stack.length > MAX_SURFACE_DEPTH) return null;
  if (!snapshot.stack.every(isSurfaceEntry)) return null;
  return snapshot.stack.map((entry) => ({ ...entry })) as SurfaceStack<S>;
}

/** How many browser entries sit above the Map root, or null for no Map entry. */
export function readEntriesAboveRoot(state: unknown): number | null {
  const stack = readMapSurfaceHistory(state);
  if (stack === null) return null;
  const aboveRoot = ((state as Record<string, unknown>)[MAP_SURFACE_HISTORY_KEY] as { aboveRoot?: unknown }).aboveRoot;
  return typeof aboveRoot === "number" && Number.isInteger(aboveRoot) && aboveRoot >= 0 ? aboveRoot : stack.length;
}

export function stampMapSurfaceHistory<S>(
  state: unknown,
  stack: SurfaceStack<S>,
  selectedVenueId: string,
  aboveRoot: number = stack.length,
): Record<string, unknown> {
  const base = historyStateRecord(state);
  delete base[LEGACY_SURFACE_HISTORY_KEY];
  base[MAP_SURFACE_HISTORY_KEY] = {
    version: MAP_SURFACE_HISTORY_VERSION,
    stack: stack.map((entry) => ({ ...entry })),
    aboveRoot,
  } satisfies MapSurfaceHistory<S>;

  if (selectedVenueId) {
    return withSelectionSentinel(base, selectedVenueId);
  }

  if (base.pubmaxSelection === PUBMAX_SELECTION_SENTINEL) {
    delete base.pubmaxSelection;
    delete base.venueId;
  }
  return base;
}

export type MapSurfaceOpenTransition<S> = {
  kind: "push" | "replace";
  stack: SurfaceStack<S>;
};

export function mapSurfaceOpenTransition<S>(
  stack: SurfaceStack<S>,
  entry: SurfaceEntry<S>,
): MapSurfaceOpenTransition<S> {
  const existingIndex = stack.findIndex((held) => held.id === entry.id);
  const next = openSurface(stack, entry);
  if (existingIndex < 0) {
    return { kind: "push", stack: next };
  }
  if (existingIndex === stack.length - 1) {
    return { kind: "replace", stack: next };
  }
  return {
    kind: "push",
    stack: [...stack.filter((held) => held.id !== entry.id), entry],
  };
}
