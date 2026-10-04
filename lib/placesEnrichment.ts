import type { WeeklyOpeningHours } from "@/lib/busyness";
import { OPENING_EVIDENCE_FRESH_DAYS } from "@/lib/planRouteEvidence";
import { weeklyHoursFromPlacesPeriods } from "@/lib/placesVerification";
import { isHttpUrl } from "@/lib/httpUrl";
import { parsePhoneNumber } from "@/lib/venueTruth";

export type PlacesObservation<T> = { value: T; source: "google_places"; observedAt: string };
type PlacesHours = { periods: unknown[]; weekdayDescriptions?: string[] };
export type PlacesEnrichmentRecord = {
  venueId: string;
  googlePlaceId: string;
  regularOpeningHours?: PlacesObservation<PlacesHours>;
  formattedAddress?: PlacesObservation<string>;
  nationalPhoneNumber?: PlacesObservation<string>;
  websiteUri?: PlacesObservation<string>;
};

/** Reserve the full Enterprise price for every attempt; shared free allowance is never borrowed. */
export function planPlacesEnrichment(
  verified: readonly { venueId: string; googlePlaceId: string }[],
  report: readonly { venueId: string; googlePlaceId: string; verdict: string }[],
  capUsd = 85, priorUsd = 0,
) {
  if (!Number.isFinite(capUsd) || capUsd < 0 || capUsd > 85 || !Number.isFinite(priorUsd) || priorUsd < 0)
    throw new Error("Invalid Places enrichment budget");
  const index = new Map(verified.map((row) => [row.venueId, row]));
  if (index.size !== verified.length || verified.some((row) => !/^venue-[a-z0-9-]+$/.test(row.venueId)
    || !/^[A-Za-z0-9_-]{10,}$/.test(row.googlePlaceId))) throw new Error("Invalid verified Places ledger");
  const ordered = new Map<string, { venueId: string; googlePlaceId: string }>();
  for (const verdict of ["unknown", "mismatch"]) for (const row of report) {
    const match = index.get(row.venueId);
    if (row.verdict === verdict && match?.googlePlaceId === row.googlePlaceId) ordered.set(row.venueId, match);
  }
  for (const row of verified) if (!ordered.has(row.venueId)) ordered.set(row.venueId, row);
  const allowance = Math.max(0, Math.floor((capUsd * 100 - priorUsd * 100 + 1e-7) / 2));
  const rows = [...ordered.values()].slice(0, allowance);
  return { rows, projectedUsd: rows.length * 2 / 100, omittedForBudget: ordered.size - rows.length };
}

/** Copy only fields returned for an already verified place id. Missing stays missing. */
export function placesEnrichmentRecord(
  venueId: string, googlePlaceId: string, details: Record<string, unknown>, observedAt: string,
): PlacesEnrichmentRecord {
  if (!/^venue-[a-z0-9-]+$/.test(venueId) || !/^[A-Za-z0-9_-]{10,}$/.test(googlePlaceId)
    || !Number.isFinite(Date.parse(observedAt))) throw new Error("Invalid Places observation identity or date");
  const record: PlacesEnrichmentRecord = { venueId, googlePlaceId };
  const observe = <T,>(value: T): PlacesObservation<T> => ({ value, source: "google_places", observedAt });
  for (const field of ["formattedAddress", "nationalPhoneNumber", "websiteUri"] as const) {
    const value = details[field];
    if (typeof value !== "string" || !value.trim()) continue;
    if (field === "websiteUri" && !isHttpUrl(value)) continue;
    if (field === "nationalPhoneNumber" && !parsePhoneNumber(value)) continue;
    record[field] = observe(value);
  }
  const raw = details.regularOpeningHours as PlacesHours | undefined;
  if (raw && weeklyHoursFromPlacesPeriods(raw.periods)) {
    record.regularOpeningHours = observe({
      periods: raw.periods,
      ...(Array.isArray(raw.weekdayDescriptions) && raw.weekdayDescriptions.every((line) => typeof line === "string")
        ? { weekdayDescriptions: raw.weekdayDescriptions } : {}),
    });
  }
  return record;
}

/** A copied field past this age stays shown under its own date and is due for a --refresh push. */
export const PLACES_REFRESH_DAYS = OPENING_EVIDENCE_FRESH_DAYS;

/** Oldest copied field date, or null when the record holds no field. */
export function placesRecordObservedAt(record: PlacesEnrichmentRecord): string | null {
  return [record.regularOpeningHours, record.formattedAddress, record.nationalPhoneNumber, record.websiteUri]
    .flatMap((field) => field ? [field.observedAt] : []).sort()[0] ?? null;
}

/** Copied fields keep showing with their own observedAt; only invalid or future-dated values are refused. */
export function usablePlacesObservation<T>(field: PlacesObservation<T> | undefined, now: Date): field is PlacesObservation<T> {
  if (!field || field.source !== "google_places" || typeof field.observedAt !== "string") return false;
  const age = now.getTime() - Date.parse(field.observedAt);
  return Number.isFinite(age) && age >= 0;
}

export function placesOpeningHours(record: PlacesEnrichmentRecord | null | undefined, now = new Date()): WeeklyOpeningHours | undefined {
  const field = record?.regularOpeningHours;
  return usablePlacesObservation(field, now) ? weeklyHoursFromPlacesPeriods(field.value?.periods) ?? undefined : undefined;
}
