// Compact, honest weather facts for surfaces that must show numbers, not vibes.
// Pure leaf: no fetch, no React. Callers pass an observation (or its fields)
// plus `now` for day/night wording when Open-Meteo did not carry is_day.

import { daySlot } from "@/lib/daySlot";

export type WeatherObservationFactsInput = {
  feelsLikeC: number;
  condition: string;
  precipitationProbabilityPct: number;
  windKph: number | null;
  /** From Open-Meteo `is_day` when known; null means do not claim solar day/night. */
  isDay: boolean | null;
  /** ISO instant for today's sunset in London when known. */
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

function dayNightLabel(isDay: boolean | null, now: Date): string {
  if (isDay === true) return "daylight";
  if (isDay === false) return "night";
  const slot = daySlot(now);
  if (slot === "morning" || slot === "afternoon") return "daylight";
  return "night";
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
  const dayNight = dayNightLabel(input.isDay, input.now);

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

/** "Checked 2 hours ago" (fresh) or "Last checked 3 days ago" (stale). */
export function checkedLabel(observedAtMs: number, nowMs: number, stale: boolean): string {
  return `${stale ? "Last checked" : "Checked"} ${relativeObservedLabel(observedAtMs, nowMs)}`;
}
