// Compact, honest weather facts for surfaces that must show numbers, not vibes.
// No fetch, no React. Sunset and day or night are computed at render from the
// night area's own coordinates (lib/weatherDaylight.ts); observations store
// neither.

import type { NightAreaSlug } from "@/lib/nightAreas";
import { daylightForNightArea } from "@/lib/weatherDaylight";
import type { NightAreaWeatherObservation } from "@/lib/weatherSnapshots";

export type WeatherObservationFactsInput = {
  feelsLikeC: number;
  condition: string;
  precipitationProbabilityPct: number;
  windKph: number | null;
  /** Sun above the area's horizon at `now`; null when the area has no coordinates. */
  isDay: boolean | null;
  /** ISO instant of the area's sunset on the day of `now`, when known. */
  sunsetAt: string | null;
  now: Date;
  /** When true, prefix makes clear the reading may be out of date. */
  stale?: boolean;
};

function formatSunsetLabel(sunsetAt: string | null, now: Date, timeZone = "Europe/London"): string | null {
  if (!sunsetAt) return null;
  const sunsetMs = Date.parse(sunsetAt);
  if (!Number.isFinite(sunsetMs)) return null;
  const time = new Intl.DateTimeFormat("en-GB", {
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  }).format(new Date(sunsetMs));
  if (now.getTime() >= sunsetMs) return `sunset was ${time}`;
  return `sunset ${time}`;
}

function dayNightLabel(isDay: boolean | null): string | null {
  if (isDay === null) return null;
  return isDay ? "daylight" : "night";
}

/**
 * One comma-separated facts line: temperature, sky, rain chance, wind, sunset,
 * day or night. British spelling throughout. Stale readings are labelled plainly.
 */
export function formatWeatherObservationFacts(input: WeatherObservationFactsInput): string {
  const temp = `${Math.round(input.feelsLikeC)}°C feels like`;
  const condition = input.condition.trim().toLocaleLowerCase("en-GB");
  const rain = `${Math.round(input.precipitationProbabilityPct)}% chance of rain`;
  const wind =
    input.windKph !== null && Number.isFinite(input.windKph)
      ? `${Math.round(input.windKph)} km/h wind`
      : null;
  const sunset = formatSunsetLabel(input.sunsetAt, input.now);
  const dayNight = dayNightLabel(input.isDay);

  const core = [temp, condition, rain, wind, sunset, dayNight].filter(
    (part): part is string => typeof part === "string" && part.length > 0,
  );
  const body = core.join(", ");
  return `${input.stale ? "Last read of the sky: " : ""}${body}.`;
}

// Human "x ago" from an observation timestamp. Floor-based so the label only
// ever rounds down (never claims fresher than it is). London-agnostic: a
// duration, not a wall clock.
export function relativeObservedLabel(observedAtMs: number, nowMs: number): string {
  const diff = Math.max(0, nowMs - observedAtMs);
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} ${minutes === 1 ? "minute" : "minutes"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

export type ObservationFacts = {
  /** Numbers-led line: temp, rain, wind, sunset, day or night. */
  factsLine: string;
  /** "Checked 2 hours ago" (fresh) or "Last checked 3 days ago" (stale). */
  checkedLabel: string;
  /** True once the observation has aged past its own expiry. */
  stale: boolean;
  /** Sun above the area's horizon at the instant the facts describe. */
  isDay: boolean | null;
};

/**
 * The one reading of an observation every weather surface shares. A fresh
 * reading is described at `now`; a stale one at the instant it was observed,
 * so an old sky never borrows tonight's sunset or darkness.
 */
export function observationFacts(input: {
  observation: Pick<
    NightAreaWeatherObservation,
    "feelsLikeC" | "condition" | "precipitationProbabilityPct" | "windKph" | "observedAt"
  >;
  nightArea: NightAreaSlug;
  now: Date;
  stale: boolean;
}): ObservationFacts {
  const { observation, nightArea, now, stale } = input;
  const observedMs = Date.parse(observation.observedAt);
  const factsAt = stale ? new Date(observedMs) : now;
  const daylight = daylightForNightArea(nightArea, factsAt);
  const isDay = daylight?.isDay ?? null;
  const factsLine = formatWeatherObservationFacts({
    feelsLikeC: observation.feelsLikeC,
    condition: observation.condition,
    precipitationProbabilityPct: observation.precipitationProbabilityPct,
    windKph: observation.windKph,
    isDay,
    sunsetAt: daylight ? daylight.sunsetAt.toISOString() : null,
    now: factsAt,
    stale,
  });
  const relative = relativeObservedLabel(observedMs, now.getTime());
  return {
    factsLine,
    checkedLabel: `${stale ? "Last checked" : "Checked"} ${relative}`,
    stale,
    isDay,
  };
}
