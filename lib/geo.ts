// Small shared geo helpers used across the client surfaces.

/** Round a lat/lng to 3 decimals (~110 m): coarse enough to find the nearest
 * station or venue, but never the drinker's doorstep, before a coordinate
 * leaves the device. */
export function roundCoord(value: number): number {
  return Math.round(value * 1000) / 1000;
}
