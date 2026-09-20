import {
  MAP_READER_LOCATION_LATCH_EVENT,
  MAP_READER_POSITION_WATCH_OPTIONS,
  mapReaderPositionFromGeolocation,
  type MapReaderPosition,
} from "@/lib/mapReaderPosition";

export type MapReaderPositionListener = (position: MapReaderPosition | null) => void;

/**
 * Watch the reader's fix for the map dot. Never prompts; starts on granted
 * permission or {@link MAP_READER_LOCATION_LATCH_EVENT}.
 */
export function attachMapReaderPositionWatch(
  onUpdate: MapReaderPositionListener,
): () => void {
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    return () => {};
  }

  let watchId: number | null = null;
  let permissionStatus: PermissionStatus | null = null;

  const stopWatch = () => {
    if (watchId !== null) {
      navigator.geolocation.clearWatch(watchId);
      watchId = null;
    }
  };

  const onPosition = (fix: GeolocationPosition) => {
    onUpdate(mapReaderPositionFromGeolocation(fix));
  };

  const onWatchError = () => {
    stopWatch();
    onUpdate(null);
  };

  const startWatch = () => {
    if (watchId !== null) return;
    watchId = navigator.geolocation.watchPosition(
      onPosition,
      onWatchError,
      MAP_READER_POSITION_WATCH_OPTIONS,
    );
  };

  const onPermissionChange = () => {
    if (!permissionStatus) return;
    if (permissionStatus.state === "granted") {
      startWatch();
      return;
    }
    stopWatch();
    onUpdate(null);
  };

  const bindPermission = async () => {
    if (!navigator.permissions?.query) return;
    try {
      permissionStatus = await navigator.permissions.query({ name: "geolocation" });
      permissionStatus.addEventListener("change", onPermissionChange);
      if (permissionStatus.state === "granted") startWatch();
    } catch {
      // Permissions API unavailable; latch after an explicit grant only.
    }
  };

  const onLatch = () => {
    startWatch();
  };

  void bindPermission();
  window.addEventListener(MAP_READER_LOCATION_LATCH_EVENT, onLatch);

  return () => {
    window.removeEventListener(MAP_READER_LOCATION_LATCH_EVENT, onLatch);
    permissionStatus?.removeEventListener("change", onPermissionChange);
    stopWatch();
  };
}
