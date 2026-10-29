import { readMapCameraProvenance, type MapCameraProvenance, type MapCameraWrite } from "@/lib/mapCameraProvenance";
import type { CityId } from "@/lib/cities";
import type { MapViewportSnapshot } from "@/lib/mobileShell";
import { validateMapViewport } from "@/lib/mobileShell";
import { offlineCache } from "@/lib/offlineCache";
import { safeLocalStorage } from "@/lib/safeStorage";
import { pinsToSlimVenues } from "@/lib/slimPins";
import type { Venue } from "@/lib/venues";
import type { SlimVenue } from "@/lib/venuesSlim";

const MAP_RESUME_VERSION = 2;
const MAP_RESUME_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
const MAP_RESUME_KEY_PREFIX = "map-resume:v2:";
// v1 kept the camera and the rows in one record, so every settled camera move
// rewrote the whole resident row set (620 KB in London) to both stores.
const LEGACY_KEY_PREFIX = "map-resume:v1:";

export type MapResumeSnapshot = {
  version: 2;
  cityId: CityId;
  savedAt: number;
  viewport: MapViewportSnapshot | null;
  cameraProvenance: MapCameraProvenance | null;
  rows: SlimVenue[];
};

export function isPersistableMapResumeViewport(
  openingLocationResolved: boolean,
  cameraSettled: boolean,
): boolean {
  return openingLocationResolved && cameraSettled;
}

function viewKeyFor(cityId: CityId): string {
  return `${MAP_RESUME_KEY_PREFIX}${cityId}:view`;
}

function rowsKeyFor(cityId: CityId): string {
  return `${MAP_RESUME_KEY_PREFIX}${cityId}:rows`;
}

function resolveStorage(storage?: Storage | null): Storage | null {
  return storage === undefined ? safeLocalStorage() : storage;
}

function validRow(value: unknown): value is SlimVenue {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.id === "string" && row.id.length > 0 &&
    typeof row.name === "string" && row.name.length > 0 &&
    typeof row.lat === "number" && Number.isFinite(row.lat) &&
    typeof row.lng === "number" && Number.isFinite(row.lng) &&
    typeof row.borough === "string" &&
    (row.cheapestPrice === null ||
      (typeof row.cheapestPrice === "number" && Number.isFinite(row.cheapestPrice)))
  );
}

function freshRecord(text: unknown, cityId: CityId, now: number): Record<string, unknown> | null {
  if (typeof text !== "string") return null;
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return null; }
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const savedAt = record.savedAt;
  if (
    record.version !== MAP_RESUME_VERSION ||
    record.cityId !== cityId ||
    typeof savedAt !== "number" ||
    !Number.isFinite(savedAt) ||
    savedAt > now ||
    now - savedAt > MAP_RESUME_MAX_AGE_MS
  ) return null;
  return record;
}

function parseSnapshot(
  viewText: unknown,
  rowsText: unknown,
  cityId: CityId,
  now: number,
): MapResumeSnapshot | null {
  const view = freshRecord(viewText, cityId, now);
  const stored = freshRecord(rowsText, cityId, now);
  const cameraProvenance = readMapCameraProvenance(view?.cameraProvenance);
  const viewport = cameraProvenance ? validateMapViewport(view?.viewport) : null;
  if (!stored || !Array.isArray(stored.rows)) return null;
  const rows = stored.rows.filter(validRow);
  if (rows.length !== stored.rows.length) return null;
  return {
    version: 2,
    cityId,
    savedAt: Math.max(stored.savedAt as number, viewport ? view!.savedAt as number : 0),
    viewport,
    cameraProvenance: viewport ? cameraProvenance : null,
    rows,
  };
}

export function readMapResumeSync(
  cityId: CityId,
  now = Date.now(),
  storage?: Storage | null,
): MapResumeSnapshot | null {
  const store = resolveStorage(storage);
  if (!store) return null;
  try {
    const view = store.getItem(viewKeyFor(cityId));
    const snapshot = parseSnapshot(view, store.getItem(rowsKeyFor(cityId)), cityId, now);
    if (view !== null && !readMapCameraProvenance(freshRecord(view, cityId, now)?.cameraProvenance)) {
      clearMapResumeCamera(cityId, store);
    }
    persistText(`${LEGACY_KEY_PREFIX}${cityId}`, null, store);
    return snapshot;
  } catch {
    return null;
  }
}

export async function readMapResume(
  cityId: CityId,
  now = Date.now(),
): Promise<MapResumeSnapshot | null> {
  try {
    await Promise.all([pendingWrites.get(viewKeyFor(cityId)), pendingWrites.get(rowsKeyFor(cityId))]);
    const [view, rows] = await Promise.all([
      offlineCache.get<unknown>(viewKeyFor(cityId)),
      offlineCache.get<unknown>(rowsKeyFor(cityId)),
    ]);
    const snapshot = parseSnapshot(view, rows, cityId, now);
    if (view !== null && !readMapCameraProvenance(freshRecord(view, cityId, now)?.cameraProvenance)) {
      clearMapResumeCamera(cityId);
    }
    persistText(`${LEGACY_KEY_PREFIX}${cityId}`, null, resolveStorage());
    return snapshot;
  } catch {
    return null;
  }
}

// Serialize camera writes and erasures so a delayed IndexedDB open cannot
// commit an older camera after its replacement or after location is requested.
const pendingWrites = new Map<string, Promise<void>>();
function persistText(
  key: string,
  text: string | null,
  store: Storage | null,
  isCurrent: () => boolean = () => true,
): void {
  const currentText = isCurrent() ? text : null;
  if (store) {
    try {
      if (currentText === null) store.removeItem(key);
      else store.setItem(key, currentText);
    } catch { /* The asynchronous cache remains optional. */ }
  }
  const pending = (pendingWrites.get(key) ?? Promise.resolve()).catch(() => {}).then(async () => {
    const value = isCurrent() ? text : null;
    await offlineCache.set(key, value);
    if (value !== null && !isCurrent()) await offlineCache.set(key, null);
  }).catch(() => {}).finally(() => {
    if (pendingWrites.get(key) === pending) pendingWrites.delete(key);
  });
  pendingWrites.set(key, pending);
}

/** Erase camera records in both stores, leaving the public venue rows intact. */
export function clearMapResumeCamera(cityId: CityId, storage?: Storage | null): void {
  const store = resolveStorage(storage);
  persistText(viewKeyFor(cityId), null, store);
  persistText(`${LEGACY_KEY_PREFIX}${cityId}`, null, store);
}

export type MapResumeWriter = (
  cityId: CityId,
  viewport: MapViewportSnapshot,
  pins: Venue[],
  now?: number,
  camera?: MapCameraWrite | null,
) => boolean;

/**
 * The map writes its resume snapshot after every settled camera move, but the
 * rows only change when the resident pins do. The camera and the rows are
 * separate records: a move writes the small camera record, the rows are
 * compacted and written once per pins array, and a move that lands on the
 * camera already written writes nothing. Returns whether it wrote.
 */
export function createMapResumeWriter(storage?: Storage | null): MapResumeWriter {
  let heldPins: Venue[] | null = null;
  let heldCityId: CityId | null = null;
  let lastView: string | null = null;
  return (cityId, viewport, pins, now = Date.now(), camera = null) => {
    const store = resolveStorage(storage);
    const city = JSON.stringify(cityId);
    const rowsChanged = pins !== heldPins || cityId !== heldCityId;
    if (rowsChanged) {
      if (cityId !== heldCityId) persistText(`${LEGACY_KEY_PREFIX}${cityId}`, null, store);
      heldPins = pins;
      heldCityId = cityId;
      const rows = JSON.stringify(pinsToSlimVenues(pins));
      persistText(rowsKeyFor(cityId), `{"version":2,"cityId":${city},"savedAt":${JSON.stringify(now)},"rows":${rows}}`, store);
    }
    if (!camera?.isCurrent()) {
      lastView = null;
      clearMapResumeCamera(cityId, store);
      return rowsChanged;
    }
    const view = `{"version":2,"cityId":${city},"cameraProvenance":${JSON.stringify(camera.provenance)},"viewport":${JSON.stringify(viewport)}`;
    if (!rowsChanged && view === lastView) return false;
    lastView = view;
    persistText(viewKeyFor(cityId), `${view},"savedAt":${JSON.stringify(now)}}`, store, camera.isCurrent);
    return true;
  };
}

type MapResumeWriteTiming = {
  requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number;
  cancelIdleCallback?: (handle: number) => void;
  setTimeout(callback: () => void, delay: number): number;
  clearTimeout(handle: number): void;
};

/** Run `write` in idle time, at most 2 s late; the returned function cancels it. */
export function scheduleMapResumeWrite(
  write: () => void,
  timing: MapResumeWriteTiming = window,
): () => void {
  let cancelled = false;
  const run = () => { if (!cancelled) write(); };
  if (typeof timing.requestIdleCallback === "function") {
    const handle = timing.requestIdleCallback(run, { timeout: 2_000 });
    return () => { cancelled = true; timing.cancelIdleCallback?.(handle); };
  }
  const handle = timing.setTimeout(run, 250);
  return () => { cancelled = true; timing.clearTimeout(handle); };
}

export type MapResumeLiveLoadStatus = "pending" | "ready" | "unavailable";

export function isCurrentMapResumeRefresh(
  liveLoadStatus: MapResumeLiveLoadStatus,
  liveRowsCommitted: boolean,
  currentVersion: number,
  refreshVersion: number,
): boolean {
  const liveResultBlocksResume =
    liveRowsCommitted &&
    (liveLoadStatus === "ready" || liveLoadStatus === "unavailable");
  return !liveResultBlocksResume && currentVersion === refreshVersion;
}
