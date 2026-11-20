import { haversineKm } from "@/lib/haversine";
import { tryGetNightArea } from "@/lib/nightAreas";
import { walkMinutesFromKm } from "@/lib/walkMinutes";

export const PRICE_ALERT_THRESHOLD_PENCE = 500;

export function isPriceAlertThreshold(value: unknown): value is number {
  return value === PRICE_ALERT_THRESHOLD_PENCE;
}

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
  if (!isPriceAlertThreshold(preference.thresholdPence)) return false;
  if (!Number.isSafeInteger(observation.pricePence) || observation.pricePence <= 0 || observation.pricePence >= PRICE_ALERT_THRESHOLD_PENCE) return false;
  if (!Number.isFinite(observation.lat) || !Number.isFinite(observation.lng)) return false;
  const distance = haversineKm([area.centre.lng, area.centre.lat], [observation.lng, observation.lat]);
  return distance <= area.radiusKm && walkMinutesFromKm(distance) <= 10;
}
