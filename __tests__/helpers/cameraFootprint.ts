// Where a MapLibre camera draws a ground point on its canvas, so a unit test
// can ask where a city's opening view puts its pubs without a WebGL canvas.
// Mercator only, flat ground, MapLibre's default 36.87 degree vertical field
// of view and 512 px world tiles.

type View = { center: [number, number]; zoom: number; pitch: number; bearing: number };

const FOV = (36.87 * Math.PI) / 180;
const EARTH_CIRCUMFERENCE_M = 40075016.686;

/** The canvas pixel `[x, y]` at which `view` draws `[lng, lat]`, or null behind the camera. */
export function screenPoint(
  view: View,
  canvas: { width: number; height: number },
  [lng, lat]: [number, number],
): [number, number] | null {
  const pitch = (view.pitch * Math.PI) / 180;
  const bearing = (view.bearing * Math.PI) / 180;
  const cameraDistance = (0.5 / Math.tan(FOV / 2)) * canvas.height;
  const cosLat = Math.cos((view.center[1] * Math.PI) / 180);
  const metresPerPixel = (EARTH_CIRCUMFERENCE_M * cosLat) / (512 * 2 ** view.zoom);
  const east = ((lng - view.center[0]) * 111320 * cosLat) / metresPerPixel;
  const north = ((lat - view.center[1]) * 110574) / metresPerPixel;
  const forward = east * Math.sin(bearing) + north * Math.cos(bearing);
  const right = east * Math.cos(bearing) - north * Math.sin(bearing);
  const depth = cameraDistance + forward * Math.sin(pitch);
  if (depth <= 0) return null;
  return [
    canvas.width / 2 + (cameraDistance * right) / depth,
    canvas.height / 2 - (cameraDistance * forward * Math.cos(pitch)) / depth,
  ];
}
