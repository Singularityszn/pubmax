import {
  MAP_READER_LOCATION_LATCH_EVENT,
  MAP_READER_POSITION_WATCH_OPTIONS,
  mapReaderPositionFromGeolocation,
  type MapReaderPosition,
} from "@/lib/mapReaderPosition";

export type MapReaderPositionListener = (position: MapReaderPosition | null) => void;

/** `GeolocationPositionError.PERMISSION_DENIED`, readable without a browser. */
const PERMISSION_DENIED = 1;

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
  // The permissions query is a promise, so a reader who navigates away before
  // it answers used to get a watch nobody could clear and a listener firing
  // into an unmounted surface. `components/map/CitySuggestBanner.tsx` guards
  // its own query the same way.
  let detached = false;

  const stopWatch = () => {
    if (watchId !== null) {
      navigator.geolocation.clearWatch(watchId);
      watchId = null;
    }
  };

  const onPosition = (fix: GeolocationPosition) => {
    if (detached) return;
    onUpdate(mapReaderPositionFromGeolocation(fix));
  };

  const onWatchError = (error: GeolocationPositionError) => {
    // A timeout or an unavailable fix is a blip: watchPosition keeps running
    // after one, so the reader's dot comes back with the next fix. Only a
    // refusal ends the watch.
    if (error.code !== PERMISSION_DENIED) return;
    stopWatch();
    if (!detached) onUpdate(null);
  };

  const startWatch = () => {
    if (detached || watchId !== null) return;
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
    if (!detached) onUpdate(null);
  };

  const bindPermission = async () => {
    if (!navigator.permissions?.query) return;
    try {
      const status = await navigator.permissions.query({ name: "geolocation" });
      if (detached) return;
      permissionStatus = status;
      status.addEventListener("change", onPermissionChange);
      if (status.state === "granted") startWatch();
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
    detached = true;
    window.removeEventListener(MAP_READER_LOCATION_LATCH_EVENT, onLatch);
    permissionStatus?.removeEventListener("change", onPermissionChange);
    permissionStatus = null;
    stopWatch();
  };
}
