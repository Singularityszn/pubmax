import { haversineMeters } from "@/lib/greatCircle.mjs";

// App coordinates use GeoJSON [lng, lat] order; the shared calculation uses
// latitude-first scalar arguments and metres.
export function haversineKm(a: [number, number], b: [number, number]): number {
  return haversineMeters(a[1], a[0], b[1], b[0]) / 1_000;
}
