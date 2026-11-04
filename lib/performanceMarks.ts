export type PubmaxPerformanceMark =
  | "pubmax:drop-tap"
  | "pubmax:drop-route-ready"
  | "pubmax:map-chunk-ready"
  | "pubmax:slim-venues-ready"
  | "pubmax:composer-mounted"
  | "pubmax:composer-interactive"
  | "pubmax:first-pins"
  | "pubmax:map-constructed"
  | "pubmax:map-style-load"
  | "pubmax:map-icons-ready"
  | "pubmax:map-scene-built"
  | "pubmax:pubs-source-loaded"
  | "pubmax:pins-visible"
  | "pubmax:basemap-drawn"
  | "pubmax:pin-entrance-settled";

const FIRST_PINS_EVENT = "pubmax:first-pins";
/** Dispatched on window when the pin layers are first made visible. */
export const PINS_VISIBLE_EVENT = "pubmax:pins-visible";
/**
 * Dispatched on window, and marked, on the first frame the streets in view are
 * all drawn: a basemap tile has loaded and no tile in view is still loading.
 */
export const BASEMAP_DRAWN_EVENT = "pubmax:basemap-drawn";
export const FIRST_PINS_SEEN_KEY = "pubmax:first-pins-seen:v1";

declare global {
  interface Window {
    __pubmaxFirstPinsReady?: boolean;
  }
}

export function markPubmaxTiming(name: PubmaxPerformanceMark): void {
  if (typeof performance !== "undefined" && typeof performance.mark === "function") {
    try {
      performance.mark(name);
    } catch {
      // Timing marks are diagnostic only; locked-down browsers should not break UI.
    }
  }
  if (typeof window === "undefined") return;
  if (name === PINS_VISIBLE_EVENT || name === BASEMAP_DRAWN_EVENT) {
    try {
      window.dispatchEvent(new Event(name));
    } catch {
      // The field-timing reporter listens for this; a restricted event API
      // must never affect the pins themselves.
    }
    return;
  }
  if (name !== FIRST_PINS_EVENT) return;
  try {
    window.__pubmaxFirstPinsReady = true;
    try {
      window.localStorage.setItem(FIRST_PINS_SEEN_KEY, "1");
    } catch {
      // A blocked storage area must not affect the first-pins signal.
    }
    window.dispatchEvent(new Event(FIRST_PINS_EVENT));
  } catch {
    // The first-pins signal is an enhancement gate. A restricted event API
    // must never affect map rendering or its timing mark.
  }
}
