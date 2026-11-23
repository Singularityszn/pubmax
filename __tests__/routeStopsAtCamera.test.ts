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

function fakeMap(zoom: number) {
  const camera = { zoom };
  const handlers = new Map<string, () => void>();
  const source = { setData: vi.fn() };
  const map = {
    getZoom: () => camera.zoom,
    project: ([lng]: [number, number]) => ({ x: 195 + (lng + 0.135) * 100_000, y: 0 }),
    getContainer: () => ({ clientWidth: 390 }),
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
});
