import type { MapBounds } from "@/lib/slimShards";

export function boundsForOpeningView(viewport: { center: [number, number]; zoom: number }): MapBounds {
  const width = typeof window === "undefined" ? 390 : Math.max(window.innerWidth, 1);
  const height = typeof window === "undefined" ? 844 : Math.max(window.innerHeight, 1);
  const scale = 512 * 2 ** viewport.zoom;
  const longitudeDelta = (width * 180) / scale;
  const latitudeDelta = (height * 180 * 1.4) / scale;
  const [lng, lat] = viewport.center;
  return {
    west: lng - longitudeDelta,
    south: Math.max(-85, lat - latitudeDelta),
    east: lng + longitudeDelta,
    north: Math.min(85, lat + latitudeDelta),
  };
}
