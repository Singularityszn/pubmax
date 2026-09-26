/** Client snapshot for useSyncExternalStore — Web Share API present. */
export function readWebShareAvailable(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.share === "function";
}

/** Server / hydration-first snapshot: never paint the native button until mounted. */
export function serverWebShareAvailable(): boolean {
  return false;
}

/** No external store events; detection is fixed for a given document lifetime. */
export function subscribeWebShare(): () => void {
  return () => {};
}
