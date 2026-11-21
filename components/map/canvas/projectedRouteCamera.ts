import * as maplibregl from "maplibre-gl";

type RouteFitOptions = {
  /** Where stop centres may sit. */
  padding: Required<maplibregl.PaddingOptions>;
  /** How far past that room the road may run, since only stops carry discs. */
  lineAllowance: number;
  bearing: number;
  pitch: number;
  maxZoom: number;
};

const FIT_PASSES = 6;
const SAME_ANGLE_DEG = 0.01;

/**
 * MapLibre fits a box on a flat plane and ignores pitch. Under the map's tilt
 * and turn, a route then fills only part of its padded room, so close stops
 * print their discs over each other in short landscape. This refines that
 * flat answer until the stops and road, projected at the camera's own pitch
 * and bearing, fill the padded room.
 *
 * At a fixed pitch and bearing, another centre and zoom only rescale each
 * point's mercator offset from the centre, so the live camera projects any
 * candidate. A fit that changes pitch or bearing, or whose refined stops
 * would leave the room, returns null and keeps MapLibre's flat fit.
 */
export function projectedRouteCamera(
  map: maplibregl.Map,
  bounds: maplibregl.LngLatBounds,
  stops: readonly [number, number][],
  line: readonly [number, number][],
  { padding, lineAllowance, bearing, pitch, maxZoom }: RouteFitOptions,
): { center: maplibregl.LngLat; zoom: number } | null {
  if (stops.length < 2 || Math.abs(map.getPitch() - pitch) > SAME_ANGLE_DEG
    || Math.abs(map.getBearing() - bearing) > SAME_ANGLE_DEG) return null;
  const flat = map.cameraForBounds(bounds, { padding, bearing, maxZoom });
  if (!flat?.center || flat.zoom === undefined) return null;
  const container = map.getContainer();
  const room = {
    left: padding.left,
    top: padding.top,
    right: container.clientWidth - padding.right,
    bottom: container.clientHeight - padding.bottom,
  };
  const liveZoom = map.getZoom();
  const liveCenter = maplibregl.MercatorCoordinate.fromLngLat(map.getCenter());
  const liveCenterPoint = map.project(map.getCenter());
  const toWorld = (coordinate: [number, number]) => maplibregl.MercatorCoordinate.fromLngLat(coordinate);
  const world = [...stops.map(toWorld), ...line.map(toWorld)];
  let center = maplibregl.MercatorCoordinate.fromLngLat(flat.center);
  let zoom = flat.zoom;
  const scale = () => 2 ** (zoom - liveZoom);
  const extent = () => {
    const points = world.map((point, index) => {
      const { x, y } = map.project(new maplibregl.MercatorCoordinate(
        liveCenter.x + (point.x - center.x) * scale(),
        liveCenter.y + (point.y - center.y) * scale(),
      ).toLngLat());
      return { x, y, allowance: index < stops.length ? 0 : lineAllowance };
    });
    return {
      left: Math.min(...points.map((point) => point.x + point.allowance)),
      right: Math.max(...points.map((point) => point.x - point.allowance)),
      top: Math.min(...points.map((point) => point.y + point.allowance)),
      bottom: Math.max(...points.map((point) => point.y - point.allowance)),
    };
  };
  for (let pass = 0; pass < FIT_PASSES; pass += 1) {
    const before = extent();
    zoom = Math.min(maxZoom, zoom + Math.log2(Math.min(
      (room.right - room.left) / Math.max(1, before.right - before.left),
      (room.bottom - room.top) / Math.max(1, before.bottom - before.top),
    )));
    const scaled = extent();
    // The candidate point that lands where the room's middle should sit becomes the centre.
    const target = maplibregl.MercatorCoordinate.fromLngLat(map.unproject([
      liveCenterPoint.x + (scaled.left + scaled.right - room.left - room.right) / 2,
      liveCenterPoint.y + (scaled.top + scaled.bottom - room.top - room.bottom) / 2,
    ]));
    center = new maplibregl.MercatorCoordinate(
      center.x + (target.x - liveCenter.x) / scale(),
      center.y + (target.y - liveCenter.y) / scale(),
    );
  }
  const fitted = extent();
  const inside = fitted.left >= room.left - 1 && fitted.right <= room.right + 1
    && fitted.top >= room.top - 1 && fitted.bottom <= room.bottom + 1;
  return inside && Number.isFinite(zoom) ? { center: center.toLngLat(), zoom } : null;
}
