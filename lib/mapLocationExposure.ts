/** The document remembers exposure only as a boolean, never as coordinates. */
export const MAP_LOCATION_EXPOSURE_EVENT = "pubmax:map-location-exposure";

type ExposureWindow = Window & { __pubmaxMapLocationExposed?: boolean };

export function mapLocationWasExposed(): boolean {
  return typeof window !== "undefined" && (window as ExposureWindow).__pubmaxMapLocationExposed === true;
}

export function markMapLocationExposure(): void {
  if (typeof window === "undefined") return;
  (window as ExposureWindow).__pubmaxMapLocationExposed = true;
  try { window.dispatchEvent(new Event(MAP_LOCATION_EXPOSURE_EVENT)); } catch {
    // The boolean still prevents a later mount from saving its camera.
  }
}
