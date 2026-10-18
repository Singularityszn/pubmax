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
  viewport: MapViewportSnapshot;
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
  const raw = JSON.parse(text) as unknown;
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
  const viewport = validateMapViewport(view?.viewport);
  if (!view || !stored || !viewport || !Array.isArray(stored.rows)) return null;
  const rows = stored.rows.filter(validRow);
  if (rows.length !== stored.rows.length) return null;
  return {
    version: 2,
    cityId,
    savedAt: view.savedAt as number,
    viewport,
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
    return parseSnapshot(store.getItem(viewKeyFor(cityId)), store.getItem(rowsKeyFor(cityId)), cityId, now);
  } catch {
    return null;
  }
}

export async function readMapResume(
  cityId: CityId,
  now = Date.now(),
): Promise<MapResumeSnapshot | null> {
  try {
    const [view, rows] = await Promise.all([
      offlineCache.get<unknown>(viewKeyFor(cityId)),
      offlineCache.get<unknown>(rowsKeyFor(cityId)),
    ]);
    return parseSnapshot(view, rows, cityId, now);
  } catch {
    return null;
  }
}

function persistText(key: string, text: string | null, store: Storage | null): void {
  if (store) {
    try {
      if (text === null) store.removeItem(key);
      else store.setItem(key, text);
    } catch {
      // IndexedDB remains available if the synchronous mirror is full.
    }
  }
  try {
    // Both stores hold the same JSON text: a string clones in one copy.
    void offlineCache.set(key, text);
  } catch {
    // IndexedDB is an optional speed layer. A blocked or full store never stops the map.
  }
}

export type MapResumeWriter = (
  cityId: CityId,
  viewport: MapViewportSnapshot,
  pins: Venue[],
  now?: number,
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
  return (cityId, viewport, pins, now = Date.now()) => {
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
    const view = `{"version":2,"cityId":${city},"viewport":${JSON.stringify(viewport)}`;
    if (!rowsChanged && view === lastView) return false;
    lastView = view;
    persistText(viewKeyFor(cityId), `${view},"savedAt":${JSON.stringify(now)}}`, store);
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
  if (typeof timing.requestIdleCallback === "function") {
    const handle = timing.requestIdleCallback(() => write(), { timeout: 2_000 });
    return () => timing.cancelIdleCallback?.(handle);
  }
  const handle = timing.setTimeout(write, 250);
  return () => timing.clearTimeout(handle);
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
