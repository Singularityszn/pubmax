import { safeLocalStorage } from "@/lib/safeStorage";

const STORAGE_KEY = "pubmax:map-opening-location:v1";
/** A recent opening hint, never a durable record of where the reader lives. */
export const MAP_OPENING_LOCATION_MAX_AGE_MS = 30 * 60 * 1000;

export type MapOpeningLocation = { lat: number; lng: number };

export type MapOpeningView = {
  center: [number, number];
  zoom: number;
  pitch: number;
  bearing: number;
};

export type MapOpeningLocationEnvironment = {
  geolocation?: Pick<Geolocation, "getCurrentPosition">;
  permissions?: Pick<Permissions, "query">;
};

export type MapOpeningLocationReadOptions = {
  onPermissionPrompt?: () => void;
  signal?: AbortSignal;
  positionOptions?: PositionOptions;
};

/** Automatic location requests need a browser grant confirmed on this visit. */
export async function readMapLocationPermission(
  environment: Pick<MapOpeningLocationEnvironment, "permissions"> | null =
    typeof navigator === "undefined" ? null : navigator,
): Promise<PermissionState | null> {
  if (typeof environment?.permissions?.query !== "function") return null;
  try {
    const permission = await environment.permissions.query({ name: "geolocation" });
    const state = permission?.state;
    return state === "granted" || state === "denied" || state === "prompt"
      ? state
      : null;
  } catch {
    return null;
  }
}

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
  now = Date.now(),
): MapOpeningLocation | null {
  const store = resolveStorage(storage);
  if (!store) return null;
  try {
    const raw = store.getItem(STORAGE_KEY);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    const savedAt = value && typeof value === "object"
      ? (value as Record<string, unknown>).savedAt
      : undefined;
    if (
      validLocation(value) &&
      typeof savedAt === "number" && Number.isFinite(savedAt) &&
      savedAt >= 0 && savedAt <= now &&
      now - savedAt < MAP_OPENING_LOCATION_MAX_AGE_MS
    ) {
      return { lat: value.lat, lng: value.lng };
    }
    store.removeItem(STORAGE_KEY);
    return null;
  } catch {
    try { store.removeItem(STORAGE_KEY); } catch { /* Storage may be blocked. */ }
    return null;
  }
}

export function writeMapOpeningLocation(
  location: MapOpeningLocation,
  storage?: Storage | null,
  now = Date.now(),
): void {
  if (!validLocation(location)) return;
  const store = resolveStorage(storage);
  if (!store) return;
  try {
    store.setItem(STORAGE_KEY, JSON.stringify({ lat: location.lat, lng: location.lng, savedAt: now }));
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

export function resolveMapOpeningView(
  cityView: MapOpeningView,
  location: MapOpeningLocation | null,
  locationZoom: number,
): MapOpeningView {
  if (!validLocation(location)) return cityView;
  return {
    ...cityView,
    center: [location.lng, location.lat],
    zoom: Math.max(cityView.zoom, locationZoom),
  };
}

export async function readOpeningMapLocation(
  environment: MapOpeningLocationEnvironment | null =
    typeof navigator === "undefined" ? null : navigator,
  options: MapOpeningLocationReadOptions = {},
): Promise<MapOpeningLocation | null> {
  if (!environment?.geolocation || options.signal?.aborted) return null;
  const geolocation = environment.geolocation;
  const readCurrentLocation = () => new Promise<MapOpeningLocation | null>((resolve) => {
    const settle = (value: MapOpeningLocation | null) => resolve(options.signal?.aborted ? null : value);
    try {
      geolocation.getCurrentPosition(
        (position) => {
          try {
            const location = {
              lat: position?.coords?.latitude,
              lng: position?.coords?.longitude,
            };
            settle(validLocation(location) ? location : null);
          } catch {
            settle(null);
          }
        },
        () => settle(null),
        options.positionOptions ?? { enableHighAccuracy: false, timeout: 2_000, maximumAge: 60_000 },
      );
    } catch {
      settle(null);
    }
  });

  const permission = await readMapLocationPermission(environment);
  if (options.signal?.aborted) return null;
  if (permission === "denied") return null;
  if (permission !== "granted") {
    options.onPermissionPrompt?.();
    return null;
  }
  return readCurrentLocation();
}
