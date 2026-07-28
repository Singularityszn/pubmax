// Browser-safe domain core for authored weather Recommendations.
//
// A Recommendation is one Pubmaxxer's short opinion that a venue suits a
// specific kind of weather. It is not a review, a verified venue fact, or a
// suggestion computed by PUBMAXX. Keeping the vocabulary and validator here
// lets the venue card and API enforce the same boundary.

import { normalizeHandle } from "@/lib/profiles";
import { presentableDescription } from "@/lib/slopFilter";

export const WEATHER_RECOMMENDATION_CONDITIONS = [
  "warm",
  "clear",
  "raining",
  "cold",
  "windy",
] as const;

export type WeatherRecommendationCondition =
  (typeof WEATHER_RECOMMENDATION_CONDITIONS)[number];

export const WEATHER_RECOMMENDATION_META: Record<
  WeatherRecommendationCondition,
  { label: string; sentence: string }
> = {
  warm: { label: "Warm", sentence: "it’s warm" },
  clear: { label: "Clear skies", sentence: "the sky is clear" },
  raining: { label: "Raining", sentence: "it’s raining" },
  cold: { label: "Cold", sentence: "it’s cold" },
  windy: { label: "Windy", sentence: "it’s windy" },
};

export const WEATHER_RECOMMENDATION_REASON_MIN = 8;
export const WEATHER_RECOMMENDATION_REASON_MAX = 160;

const MAX_VENUE_ID = 64;

export type WeatherRecommendationInput = {
  venueId: string;
  condition: WeatherRecommendationCondition;
  reason: string;
  contributorHandle: string;
};

export type WeatherRecommendation = WeatherRecommendationInput & {
  id: string;
  /** Server clock in epoch milliseconds. */
  submittedAt: number;
  /** Public provenance lane. The private actor token never leaves the store. */
  source: "community";
};

export type WeatherRecommendationValidation =
  | { ok: true; value: WeatherRecommendationInput }
  | { ok: false; error: string };

export type RecommendationWeather = {
  condition: string;
  feelsLikeC: number;
  precipitationProbabilityPct: number;
  windKph: number | null;
};

function clean(value: unknown, cap: number): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/[<>]/g, "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, cap);
}

export function isWeatherRecommendationCondition(
  value: unknown,
): value is WeatherRecommendationCondition {
  return (
    typeof value === "string" &&
    (WEATHER_RECOMMENDATION_CONDITIONS as readonly string[]).includes(
      value.toLocaleLowerCase("en-GB"),
    )
  );
}

export function weatherRecommendationConditionLabel(
  condition: WeatherRecommendationCondition,
): string {
  return WEATHER_RECOMMENDATION_META[condition].label;
}

export function weatherRecommendationConditionSentence(
  condition: WeatherRecommendationCondition,
): string {
  return WEATHER_RECOMMENDATION_META[condition].sentence;
}

export function validateWeatherRecommendation(
  input: unknown,
): WeatherRecommendationValidation {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "Missing recommendation." };
  }
  const raw = input as Record<string, unknown>;
  const venueId = clean(raw.venueId, MAX_VENUE_ID);
  if (!venueId) return { ok: false, error: "A venue is required." };

  const condition =
    typeof raw.condition === "string"
      ? raw.condition.trim().toLocaleLowerCase("en-GB")
      : "";
  if (!isWeatherRecommendationCondition(condition)) {
    return { ok: false, error: "Pick the weather this suits." };
  }

  const contributorHandle = normalizeHandle(
    typeof raw.contributorHandle === "string" ? raw.contributorHandle : "",
  );
  if (!contributorHandle) {
    return { ok: false, error: "Add your Pubmaxx handle." };
  }

  const cleanedReason = clean(
    raw.reason,
    WEATHER_RECOMMENDATION_REASON_MAX,
  );
  if (cleanedReason.length < WEATHER_RECOMMENDATION_REASON_MIN) {
    return {
      ok: false,
      error: `Say why in at least ${WEATHER_RECOMMENDATION_REASON_MIN} characters.`,
    };
  }
  const reason = presentableDescription(cleanedReason);
  if (!reason) {
    return {
      ok: false,
      error: "Say plainly why you would pick this pub.",
    };
  }

  return {
    ok: true,
    value: {
      venueId,
      condition,
      reason,
      contributorHandle,
    },
  };
}

function validWeather(weather: RecommendationWeather): boolean {
  return (
    typeof weather.condition === "string" &&
    Number.isFinite(weather.feelsLikeC) &&
    Number.isFinite(weather.precipitationProbabilityPct) &&
    weather.precipitationProbabilityPct >= 0 &&
    weather.precipitationProbabilityPct <= 100 &&
    (weather.windKph === null ||
      (Number.isFinite(weather.windKph) && weather.windKph >= 0))
  );
}

/**
 * Derive every closed condition that current cached weather supports.
 *
 * `clear` deliberately means clear skies, not sunny. Existing snapshots do not
 * carry day/night state, so calling a clear evening sunny would overstate what
 * Open-Meteo told us. Conditions may overlap because warmth and wind are
 * independent reasons to choose a venue.
 */
export function conditionsForWeather(
  weather: RecommendationWeather,
): WeatherRecommendationCondition[] {
  if (!validWeather(weather)) return [];
  const conditions: WeatherRecommendationCondition[] = [];
  if (weather.feelsLikeC >= 18) conditions.push("warm");
  if (
    /\b(clear|sun|sunny)\b/i.test(weather.condition) &&
    weather.precipitationProbabilityPct < 30
  ) {
    conditions.push("clear");
  }
  if (
    weather.precipitationProbabilityPct >= 60 ||
    /\b(rain|drizzle|storm|shower|snow)\w*\b/i.test(weather.condition)
  ) {
    conditions.push("raining");
  }
  if (weather.feelsLikeC < 8) conditions.push("cold");
  if (weather.windKph !== null && weather.windKph >= 30) {
    conditions.push("windy");
  }
  return conditions;
}

export function matchingWeatherRecommendations(
  recommendations: readonly WeatherRecommendation[],
  conditions: readonly WeatherRecommendationCondition[],
): WeatherRecommendation[] {
  const active = new Set(conditions);
  return recommendations.filter((recommendation) =>
    active.has(recommendation.condition),
  );
}
