import { haversineKm } from "@/lib/haversine";
import { walkMinutesFromKm } from "@/lib/walkMinutes";

export const PRICE_ALERT_THRESHOLDS = [400, 450, 500, 550, 600] as const;

export function isPriceAlertThreshold(value: unknown): value is number {
  return PRICE_ALERT_THRESHOLDS.some((threshold) => threshold === value);
}

export type PriceAlertPreference = {
  lat: number;
  lng: number;
  thresholdPence: number;
  enabled: boolean;
};

export function isPriceAlertLocation(value: unknown): value is { lat: number; lng: number } {
  if (!value || typeof value !== "object") return false;
  const { lat, lng } = value as Record<string, unknown>;
  return typeof lat === "number" && Number.isFinite(lat) && lat >= -90 && lat <= 90
    && typeof lng === "number" && Number.isFinite(lng) && lng >= -180 && lng <= 180;
}

export type PriceAlertObservation = {
  pricePence: number;
  lat: number;
  lng: number;
};

export function matchesPriceAlert(
  preference: PriceAlertPreference,
  observation: PriceAlertObservation,
): boolean {
  if (!preference.enabled || !isPriceAlertLocation(preference)) return false;
  if (!isPriceAlertThreshold(preference.thresholdPence)) return false;
  if (!Number.isSafeInteger(observation.pricePence) || observation.pricePence <= 0 || observation.pricePence >= preference.thresholdPence) return false;
  if (!isPriceAlertLocation(observation)) return false;
  const distance = haversineKm([preference.lng, preference.lat], [observation.lng, observation.lat]);
  return walkMinutesFromKm(distance) <= 10;
}
