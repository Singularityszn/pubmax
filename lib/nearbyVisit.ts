import { haversineKm } from "@/lib/haversine";

export function isNearbyVisit(raw: unknown, venue: { lat: number; lng: number }, now = Date.now()): boolean {
  if (!raw || typeof raw !== "object") return false;
  const { lat, lng, accuracy, timestamp } = raw as Record<string, unknown>;
  if (![lat, lng, accuracy, timestamp, venue.lat, venue.lng].every((value) => typeof value === "number" && Number.isFinite(value))) return false;
  if (typeof lat !== "number" || typeof lng !== "number" || typeof accuracy !== "number" || typeof timestamp !== "number") return false;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180 || accuracy < 0 || accuracy > 100) return false;
  if (now - timestamp > 60_000 || timestamp - now > 10_000) return false;
  return haversineKm([lng, lat], [venue.lng, venue.lat]) * 1_000 + accuracy <= 200;
}

export type NearbyVisit = { venueId: string; checkedAt: string };
