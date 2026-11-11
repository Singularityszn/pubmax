export interface StationZone {
  name: string;
  lat: number;
  lng: number;
  zone: number;
}

export interface NearestStationZone {
  zone: number;
  station: string;
  distanceKm: number;
}

export function nearestStationZone(
  lat: number,
  lng: number,
  stations: readonly StationZone[],
): NearestStationZone | null;
