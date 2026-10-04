import type { WeeklyOpeningHours } from "@/lib/busyness";
import { OPENING_EVIDENCE_FRESH_DAYS } from "@/lib/planRouteEvidence";
import { weeklyHoursFromPlacesPeriods } from "@/lib/placesVerification";
import { isHttpUrl } from "@/lib/httpUrl";
import { parsePhoneNumber } from "@/lib/venueTruth";

export type PlacesObservation<T> = { value: T; source: "google_places"; observedAt: string };
type PlacesHours = { periods: unknown[]; weekdayDescriptions?: string[] };
const BOOLEAN_FIELDS = ["outdoorSeating", "servesBeer", "servesWine", "servesCocktails", "goodForGroups", "liveMusic",
  "allowsDogs", "goodForWatchingSports", "menuForChildren", "servesBreakfast", "servesBrunch", "servesLunch", "servesDinner",
  "servesVegetarianFood", "reservable", "restroom"] as const;
const OPTION_FIELDS = {
  accessibilityOptions: ["wheelchairAccessibleEntrance", "wheelchairAccessibleParking", "wheelchairAccessibleRestroom", "wheelchairAccessibleSeating"],
  paymentOptions: ["acceptsCreditCards", "acceptsDebitCards", "acceptsCashOnly", "acceptsNfc"],
} as const;
/** Every extras field bills under the one Enterprise + Atmosphere request, and each has a typed reader below. */
export const PLACES_EXTRAS_FIELD_MASK = ["rating", "userRatingCount", "priceLevel", "editorialSummary", ...BOOLEAN_FIELDS, ...Object.keys(OPTION_FIELDS)].join(",");
export const PLACES_PRICE_LABELS = {
  PRICE_LEVEL_FREE: "Free", PRICE_LEVEL_INEXPENSIVE: "£", PRICE_LEVEL_MODERATE: "££",
  PRICE_LEVEL_EXPENSIVE: "£££", PRICE_LEVEL_VERY_EXPENSIVE: "££££",
} as const;
export type PlacesEnrichmentRecord = Partial<Record<typeof BOOLEAN_FIELDS[number], PlacesObservation<boolean>>> & {
  venueId: string;
  googlePlaceId: string;
  observedAt: string;
  regularOpeningHours?: PlacesObservation<PlacesHours>;
  formattedAddress?: PlacesObservation<string>;
  nationalPhoneNumber?: PlacesObservation<string>;
  websiteUri?: PlacesObservation<string>;
  rating?: PlacesObservation<number>;
  userRatingCount?: PlacesObservation<number>;
  priceLevel?: PlacesObservation<keyof typeof PLACES_PRICE_LABELS>;
  editorialSummary?: PlacesObservation<{ text: string; languageCode?: string }>;
} & { -readonly [Field in keyof typeof OPTION_FIELDS]?: PlacesObservation<Partial<Record<typeof OPTION_FIELDS[Field][number], boolean>>> };

/** Reserve the full Enterprise price for every attempt; shared free allowance is never borrowed. */
export function planPlacesEnrichment(
  verified: readonly { venueId: string; googlePlaceId: string }[],
  report: readonly { venueId: string; googlePlaceId: string; verdict: string }[],
  capUsd = 85, priorUsd = 0, usdPerThousand: 20 | 25 = 20,
) {
  if (![20, 25].includes(usdPerThousand) || !Number.isFinite(capUsd) || capUsd < 0 || capUsd > 85 || !Number.isFinite(priorUsd) || priorUsd < 0)
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
  const allowance = Math.max(0, Math.floor((capUsd * 1000 - priorUsd * 1000 + 1e-7) / usdPerThousand));
  const rows = [...ordered.values()].slice(0, allowance);
  return { rows, projectedUsd: rows.length * usdPerThousand / 1000, omittedForBudget: ordered.size - rows.length };
}

/** Copy only fields returned for an already verified place id. Missing stays missing. */
export function placesEnrichmentRecord(
  venueId: string, googlePlaceId: string, details: Record<string, unknown>, observedAt: string,
): PlacesEnrichmentRecord {
  if (!/^venue-[a-z0-9-]+$/.test(venueId) || !/^[A-Za-z0-9_-]{10,}$/.test(googlePlaceId)
    || !Number.isFinite(Date.parse(observedAt))) throw new Error("Invalid Places observation identity or date");
  const record: PlacesEnrichmentRecord = { venueId, googlePlaceId, observedAt };
  const observe = <T,>(value: T): PlacesObservation<T> => ({ value, source: "google_places", observedAt });
  for (const field of ["formattedAddress", "nationalPhoneNumber", "websiteUri"] as const) {
    const value = details[field];
    if (typeof value !== "string" || !value.trim()) continue;
    if (field === "websiteUri" && !isHttpUrl(value)) continue;
    if (field === "nationalPhoneNumber" && !parsePhoneNumber(value)) continue;
    record[field] = observe(value);
  }
  if (typeof details.rating === "number" && Number.isFinite(details.rating) && details.rating >= 1 && details.rating <= 5)
    record.rating = observe(details.rating);
  if (typeof details.userRatingCount === "number" && Number.isSafeInteger(details.userRatingCount) && details.userRatingCount >= 0)
    record.userRatingCount = observe(details.userRatingCount);
  if (typeof details.priceLevel === "string" && Object.hasOwn(PLACES_PRICE_LABELS, details.priceLevel))
    record.priceLevel = observe(details.priceLevel as keyof typeof PLACES_PRICE_LABELS);
  for (const field of BOOLEAN_FIELDS) if (typeof details[field] === "boolean") record[field] = observe(details[field]);
  const summary = details.editorialSummary as { text?: unknown; languageCode?: unknown } | undefined;
  if (summary && typeof summary.text === "string" && summary.text.trim()) {
    record.editorialSummary = observe({ text: summary.text,
      ...(typeof summary.languageCode === "string" ? { languageCode: summary.languageCode } : {}) });
  }
  for (const [field, keys] of Object.entries(OPTION_FIELDS) as [keyof typeof OPTION_FIELDS, readonly string[]][]) {
    const options = details[field];
    if (!options || typeof options !== "object") continue;
    const value = Object.fromEntries(keys.flatMap((key) => {
      const flag = (options as Record<string, unknown>)[key];
      return typeof flag === "boolean" ? [[key, flag]] : [];
    }));
    if (Object.keys(value).length) record[field] = observe(value);
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

/** A copied field past this age stays shown under its own date, stops deciding open state and is due for a --refresh push. */
export const PLACES_REFRESH_DAYS = OPENING_EVIDENCE_FRESH_DAYS;

/** Copied fields keep showing with their own observedAt; only invalid, future-dated or (with maxAgeDays) older values are refused. */
export function usablePlacesObservation<T>(field: PlacesObservation<T> | undefined, now: Date, maxAgeDays = Infinity): field is PlacesObservation<T> {
  if (!field || field.source !== "google_places" || typeof field.observedAt !== "string") return false;
  const age = now.getTime() - Date.parse(field.observedAt);
  return Number.isFinite(age) && age >= 0 && age <= maxAgeDays * 86_400_000;
}

/** Display hours at any age; pass PLACES_REFRESH_DAYS where the hours decide open state. */
export function placesOpeningHours(record: PlacesEnrichmentRecord | null | undefined, now = new Date(), maxAgeDays = Infinity): WeeklyOpeningHours | undefined {
  const field = record?.regularOpeningHours;
  return usablePlacesObservation(field, now, maxAgeDays) ? weeklyHoursFromPlacesPeriods(field.value?.periods) ?? undefined : undefined;
}
