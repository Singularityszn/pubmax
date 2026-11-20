import { haversineKm } from "@/lib/haversine";
import { tryGetNightArea } from "@/lib/nightAreas";
import { walkMinutesFromKm } from "@/lib/walkMinutes";

export type PriceAlertPreference = {
  area: string;
  thresholdPence: number;
  enabled: boolean;
};

export type PriceAlertObservation = {
  pricePence: number;
  lat: number;
  lng: number;
};

export function matchesPriceAlert(
  preference: PriceAlertPreference,
  observation: PriceAlertObservation,
): boolean {
  const area = tryGetNightArea(preference.area);
  if (!preference.enabled || !area) return false;
  if (!Number.isSafeInteger(preference.thresholdPence) || preference.thresholdPence <= 0) return false;
  if (!Number.isSafeInteger(observation.pricePence) || observation.pricePence <= 0 || observation.pricePence >= preference.thresholdPence) return false;
  if (!Number.isFinite(observation.lat) || !Number.isFinite(observation.lng)) return false;
  const distance = haversineKm([area.centre.lng, area.centre.lat], [observation.lng, observation.lat]);
  return distance <= area.radiusKm && walkMinutesFromKm(distance) <= 10;
}
