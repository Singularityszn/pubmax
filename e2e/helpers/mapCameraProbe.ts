import type { Page } from "@playwright/test";

export type CameraReading = {
  bearing: number;
  pitch: number;
  zoom: number;
  center: [number, number];
  moving: boolean;
  settling: boolean;
};

export type PaintedPoint = {
  kind: "pin" | "cluster";
  id: string;
  x: number;
  y: number;
  lng: number;
  lat: number;
};

export async function readCamera(page: Page): Promise<CameraReading> {
  return page.evaluate(() => {
    const probe = (window as unknown as {
      __pubmaxMapCamera?: { read: () => CameraReading };
    }).__pubmaxMapCamera;
    if (!probe) throw new Error("camera probe absent");
    return probe.read();
  }) as Promise<CameraReading>;
}

export async function paintedPoints(page: Page): Promise<PaintedPoint[]> {
  return page.evaluate(() => {
    const probe = (window as unknown as {
      __pubmaxPaintedMapTapPoints?: () => PaintedPoint[];
    }).__pubmaxPaintedMapTapPoints;
    return probe ? probe() : [];
  }) as Promise<PaintedPoint[]>;
}

/**
 * Where the camera says one coordinate is right now, in the same viewport
 * pixels the painted probe answers in.
 */
export async function projectOnMap(
  page: Page,
  lngLat: [number, number],
): Promise<{ x: number; y: number }> {
  return page.evaluate((coordinate) => {
    const probe = (window as unknown as {
      __pubmaxMapCamera?: { project: (value: [number, number]) => { x: number; y: number } };
    }).__pubmaxMapCamera;
    if (!probe) throw new Error("camera probe absent");
    return probe.project(coordinate);
  }, lngLat);
}
