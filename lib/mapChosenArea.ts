// Remembered map area chip — separate from night-patch memory (lib/nightPatches.ts).

import type { CityId } from "@/lib/cities";
import { safeLocalStorage } from "@/lib/safeStorage";

export const MAP_CHOSEN_AREA_KEY = "pubmax:map-chosen-area:v1";
const CHANGE_EVENT = "pubmax:map-chosen-area";

export type MapChosenAreaKind = "near-me" | "night-area" | "city";

export type MapChosenArea = {
  cityId: CityId;
  label: string;
  slug: string;
  center: [number, number];
  kind: MapChosenAreaKind;
};

function resolveStorage(storage?: Storage | null): Storage | null {
  if (storage !== undefined) return storage;
  return safeLocalStorage();
}

function notifyChange(): void {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new Event(CHANGE_EVENT));
  } catch {
    // Older environments without Event ctor still keep the storage write.
  }
}

function isMapChosenArea(value: unknown): value is MapChosenArea {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<MapChosenArea>;
  return (
    typeof row.cityId === "string" &&
    typeof row.label === "string" &&
    typeof row.slug === "string" &&
    Array.isArray(row.center) &&
    row.center.length === 2 &&
    typeof row.center[0] === "number" &&
    typeof row.center[1] === "number" &&
    (row.kind === "near-me" ||
      row.kind === "night-area" ||
      row.kind === "city")
  );
}

type SnapshotCache = { raw: string | null; value: MapChosenArea | null };
const snapshotByStorage = new WeakMap<Storage, SnapshotCache>();

function invalidateSnapshot(store: Storage): void {
  snapshotByStorage.delete(store);
}

function readSnapshot(store: Storage): MapChosenArea | null {
  let raw: string | null;
  try {
    raw = store.getItem(MAP_CHOSEN_AREA_KEY);
  } catch {
    return null;
  }
  const cached = snapshotByStorage.get(store);
  if (cached && cached.raw === raw) return cached.value;

  let value: MapChosenArea | null = null;
  if (raw) {
    try {
      const parsed: unknown = JSON.parse(raw);
      value = isMapChosenArea(parsed) ? parsed : null;
    } catch {
      value = null;
    }
  }
  snapshotByStorage.set(store, { raw, value });
  return value;
}

export function readMapChosenArea(storage?: Storage | null): MapChosenArea | null {
  const store = resolveStorage(storage);
  if (!store) return null;
  return readSnapshot(store);
}

export function writeMapChosenArea(
  area: MapChosenArea,
  storage?: Storage | null,
): void {
  const store = resolveStorage(storage);
  if (!store) return;
  try {
    store.setItem(MAP_CHOSEN_AREA_KEY, JSON.stringify(area));
    invalidateSnapshot(store);
    notifyChange();
  } catch {
    // Storage full / private mode — degrade silently.
  }
}

export function clearMapChosenArea(storage?: Storage | null): void {
  const store = resolveStorage(storage);
  if (!store) return;
  try {
    store.removeItem(MAP_CHOSEN_AREA_KEY);
    invalidateSnapshot(store);
    notifyChange();
  } catch {
    // Storage disabled mid-session — nothing to clean up.
  }
}

/**
 * What a fresh Map arrival owes a remembered area.
 *
 * A remembered area is the DEFAULT arrival and never an override, so this
 * answers three ways rather than two. `skip` means somebody else owns the
 * camera - an explicit arrival (?sel=, ?q=, ?place=, ?crawl=, a planner
 * handoff) already has its own fly-to in flight, and a restored session
 * viewport is fresher evidence of where this reader was than a row they tapped
 * days ago - or there is nothing here for this city. `wait` is the one answer
 * that must NOT spend the caller's one-shot: a Near me row needs venues to rank
 * against, and the index settles after the first paint.
 */
export type MapChosenAreaRestore =
  | { action: "skip" }
  | { action: "wait" }
  | { action: "restore"; area: MapChosenArea };

export function resolveMapChosenAreaRestore(input: {
  stored: MapChosenArea | null;
  cityId: CityId;
  explicitArrivalIntent: boolean;
  hasRestoredViewport: boolean;
  venueCount: number;
}): MapChosenAreaRestore {
  if (input.explicitArrivalIntent || input.hasRestoredViewport) {
    return { action: "skip" };
  }
  const stored = input.stored;
  if (!stored || stored.cityId !== input.cityId) return { action: "skip" };
  if (stored.kind === "city") return { action: "skip" };
  if (stored.kind === "near-me" && input.venueCount === 0) {
    return { action: "wait" };
  }
  return { action: "restore", area: stored };
}

export function subscribeMapChosenArea(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = () => onChange();
  window.addEventListener(CHANGE_EVENT, handler);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener(CHANGE_EVENT, handler);
    window.removeEventListener("storage", handler);
  };
}
