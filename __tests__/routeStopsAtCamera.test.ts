import { describe, expect, it, vi } from "vitest";
import type * as maplibregl from "maplibre-gl";

import { routeToStops } from "@/components/map/canvas/geojson";
import { followRouteStopsCamera, showRouteStopsAtCamera } from "@/components/map/canvas/routeStopsAtCamera";

// Cafe Sol and The Ox stand 15 m apart; VennStreet Records is 400 m away.
const CLAPHAM = [
  { id: "venue-5fcgge", name: "Cafe Sol", longitude: -0.132851, latitude: 51.4639 },
  { id: "venue-slmiao", name: "The Ox", longitude: -0.1326362, latitude: 51.4639376 },
  { id: "venue-19vsru5", name: "VennStreet Records", longitude: -0.137969, latitude: 51.4623566 },
];

/** Two pubs on one street that runs north, `south` the nearer the camera. */
function northSouthPair(north: number, south: number) {
  return [
    { id: "north", name: "The North Star", longitude: -0.1328, latitude: north },
    { id: "south", name: "The Southern Cross", longitude: -0.1328, latitude: south },
  ];
}

function worldPixel([lng, lat]: [number, number], zoom: number): [number, number] {
  const size = 512 * 2 ** zoom;
  const sin = Math.sin((lat * Math.PI) / 180);
  return [((lng + 180) / 360) * size, (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * size];
}

/**
 * A phone-sized map whose camera tilts by `pitch` the way MapLibre's does: a
 * 36.87° field of view looking at `center`, north up.
 */
function fakeMap(zoom: number, { pitch = 0, center = [-0.1328, 51.4639] as [number, number] } = {}) {
  const camera = { zoom };
  const width = 390;
  const height = 844;
  const toCenter = 1.5 * height;
  const tilt = (pitch * Math.PI) / 180;
  const handlers = new Map<string, () => void>();
  const source = { setData: vi.fn() };
  const map = {
    getZoom: () => camera.zoom,
    getBearing: () => 0,
    getCenter: () => ({ lng: center[0], lat: center[1] }),
    project: (point: [number, number]) => {
      const [x, y] = worldPixel(point, camera.zoom);
      const [cx, cy] = worldPixel(center, camera.zoom);
      const ahead = cy - y;
      const depth = toCenter + ahead * Math.sin(tilt);
      return { x: width / 2 + (toCenter * (x - cx)) / depth, y: height / 2 - (toCenter * ahead * Math.cos(tilt)) / depth };
    },
    getContainer: () => ({ clientWidth: width, clientHeight: height }),
    getSource: (id: string) => (id === "route-stops" ? source : undefined),
    on: (event: string, handler: () => void) => handlers.set(event, handler),
  } as unknown as maplibregl.Map;
  const zoomTo = (next: number) => {
    camera.zoom = next;
    handlers.get("zoom")?.();
  };
  const shownLabels = () => (source.setData.mock.lastCall?.[0] as GeoJSON.FeatureCollection)
    .features.map((feature) => feature.properties?.label);
  return { map, source, zoomTo, shownLabels };
}

describe("route stops on the full map", () => {
  it("share one disc at the fitted zoom and part as the reader zooms in", () => {
    const { map, source, zoomTo, shownLabels } = fakeMap(15.5);
    followRouteStopsCamera(map);
    showRouteStopsAtCamera(map, { stops: routeToStops(CLAPHAM) });
    expect(shownLabels()).toEqual(["1·2", "3"]);

    zoomTo(15.6);
    expect(source.setData).toHaveBeenCalledTimes(1);

    zoomTo(19);
    expect(shownLabels()).toEqual(["1", "2", "3"]);
  });

  it("let the selected stop lead its shared disc", () => {
    const { map, source } = fakeMap(15.5);
    showRouteStopsAtCamera(map, { stops: routeToStops(CLAPHAM, true) });
    showRouteStopsAtCamera(map, { leadId: "venue-slmiao" });
    const [shared] = (source.setData.mock.lastCall?.[0] as GeoJSON.FeatureCollection).features;
    expect(shared!.properties).toMatchObject({ id: "venue-slmiao", label: "1·2", walk: true });
  });

  it("share one disc where the tilt draws two stops on one street over each other", () => {
    // 44 px apart flat at z17, and only 33 px on screen under the map's 42° tilt.
    const { map, zoomTo, shownLabels } = fakeMap(17, { pitch: 42 });
    followRouteStopsCamera(map);
    showRouteStopsAtCamera(map, { stops: routeToStops(northSouthPair(51.463974, 51.463826)) });
    expect(shownLabels()).toEqual(["1·2"]);

    zoomTo(18);
    expect(shownLabels()).toEqual(["1", "2"]);
  });

  it("measure the larger disc the tilted map paints nearer the camera", () => {
    // Low on the screen the stops sit 38 px apart, clear of a flat disc but not
    // of the 41 px disc MapLibre paints that near the camera.
    const { map, shownLabels } = fakeMap(17, { pitch: 42, center: [-0.1328, 51.46457] });
    showRouteStopsAtCamera(map, { stops: routeToStops(northSouthPair(51.463969, 51.463831)) });
    expect(shownLabels()).toEqual(["1·2"]);
  });
});
