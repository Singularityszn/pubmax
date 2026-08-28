import { safeLocalStorage } from "@/lib/safeStorage";

const STORAGE_KEY = "pubmax:map-opening-location:v1";

export type MapOpeningLocation = { lat: number; lng: number };

function validLocation(value: unknown): value is MapOpeningLocation {
  if (!value || typeof value !== "object") return false;
  const raw = value as Record<string, unknown>;
  return (
    typeof raw.lat === "number" && Number.isFinite(raw.lat) &&
    raw.lat >= -90 && raw.lat <= 90 &&
    typeof raw.lng === "number" && Number.isFinite(raw.lng) &&
    raw.lng >= -180 && raw.lng <= 180
  );
}

function resolveStorage(storage?: Storage | null): Storage | null {
  return storage === undefined ? safeLocalStorage() : storage;
}

export function readMapOpeningLocation(
  storage?: Storage | null,
): MapOpeningLocation | null {
  const store = resolveStorage(storage);
  if (!store) return null;
  try {
    const raw = store.getItem(STORAGE_KEY);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    return validLocation(value) ? value : null;
  } catch {
    return null;
  }
}

export function writeMapOpeningLocation(
  location: MapOpeningLocation,
  storage?: Storage | null,
): void {
  if (!validLocation(location)) return;
  const store = resolveStorage(storage);
  if (!store) return;
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(location));
  } catch {
    // Location is an optional speed hint. Storage failure never blocks the map.
  }
}

export function resolveMapOpeningLocation(
  lastKnown: MapOpeningLocation | null,
  cityDefault: MapOpeningLocation,
): MapOpeningLocation {
  return validLocation(lastKnown) ? lastKnown : cityDefault;
}

export const MAP_OPENING_LOCATION_STORAGE_KEY = STORAGE_KEY;
