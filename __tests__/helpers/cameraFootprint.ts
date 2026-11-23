// The ground a MapLibre camera shows inside one screen rectangle, so a unit
// test can ask which pubs a city's opening view puts on screen without a
// WebGL canvas. Mercator only, flat ground, MapLibre's default 36.87 degree
// vertical field of view and 512 px world tiles.

type View = { center: [number, number]; zoom: number; pitch: number; bearing: number };
export type ScreenInsets = { top: number; right: number; bottom: number; left: number };

const FOV = (36.87 * Math.PI) / 180;
const EARTH_CIRCUMFERENCE_M = 40075016.686;

function groundPoint(view: View, width: number, height: number, x: number, y: number): [number, number] {
  const pitch = (view.pitch * Math.PI) / 180;
  const bearing = (view.bearing * Math.PI) / 180;
  const cameraDistance = (0.5 / Math.tan(FOV / 2)) * height;
  const dx = x - width / 2;
  const dy = y - height / 2;
  const denominator = cameraDistance * Math.cos(pitch) + dy * Math.sin(pitch);
  if (denominator <= 0) throw new Error(`Screen point ${x},${y} is above the horizon`);
  const t = (cameraDistance * Math.cos(pitch)) / denominator;
  const forward = -cameraDistance * Math.sin(pitch) + t * (cameraDistance * Math.sin(pitch) - dy * Math.cos(pitch));
  const right = t * dx;
  const [lng, lat] = view.center;
  const cosLat = Math.cos((lat * Math.PI) / 180);
  const metresPerPixel = (EARTH_CIRCUMFERENCE_M * cosLat) / (512 * 2 ** view.zoom);
  const east = (forward * Math.sin(bearing) + right * Math.cos(bearing)) * metresPerPixel;
  const north = (forward * Math.cos(bearing) - right * Math.sin(bearing)) * metresPerPixel;
  return [lng + east / (111320 * cosLat), lat + north / 110574];
}

function insidePolygon([x, y]: [number, number], polygon: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** How many of `points` ([lng, lat]) the camera draws clear of the chrome insets. */
export function pointsInClearView(
  view: View,
  screen: { width: number; height: number; insets: ScreenInsets },
  points: readonly [number, number][],
): number {
  const { width, height, insets } = screen;
  const corners: [number, number][] = [
    [insets.left, insets.top],
    [width - insets.right, insets.top],
    [width - insets.right, height - insets.bottom],
    [insets.left, height - insets.bottom],
  ];
  const polygon = corners.map(([x, y]) => groundPoint(view, width, height, x, y));
  return points.filter((point) => insidePolygon(point, polygon)).length;
}
