// Open-Meteo night-area weather provider — the keyless fetch half of the cron
// weather plane. This is the SAME provider + contract as the legacy
// scripts/refresh_weather_snapshots.mjs (Open-Meteo forecast, current apparent
// temperature + weather code + wind + next-hour precipitation probability), but
// as a typed lib the serverless cron route can call directly.
//
// KEYS: none. Open-Meteo is keyless, so the weather feed always runs. There is
// no "missing key → skip" branch here (unlike the What's-On event providers) —
// that honesty is documented in the runbook.
//
// Every observation is validated through the shared row contract
// (validateWeatherObservation) before it leaves this module, so a malformed or
// out-of-range provider payload is DROPPED, never persisted as fake data.

import { LONDON_NIGHT_AREA_SLUGS, type LondonNightAreaSlug } from "@/lib/nightAreas";
import {
  validateWeatherObservation,
  type NightAreaWeatherObservation,
} from "@/lib/weatherSnapshots";

import { LONDON_LONDON_NIGHT_AREA_COORDS } from "@/lib/weatherAreaCoords";

// [lat, lng] centroids per LONDON night area — the established set the scheduled
// refresh has always polled (kept in lockstep with
// scripts/refresh_weather_snapshots.mjs). The snapshot this feeds is London's,
// so the table is keyed on London's own patches: an area in another city has no
// row here and reads as no weather rather than as somebody else's.
const OBSERVATION_TTL_HOURS = 12;

export function conditionForCode(code: number): string {
  if (code === 0) return "Clear";
  if ([1, 2, 3].includes(code)) return "Cloudy";
  if ([45, 48].includes(code)) return "Fog";
  if ([51, 53, 55, 56, 57].includes(code)) return "Drizzle";
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return "Rain";
  if ([71, 73, 75, 77, 85, 86].includes(code)) return "Snow";
  if ([95, 96, 99].includes(code)) return "Thunderstorm";
  return `Weather code ${code}`;
}

/** Injectable fetch so route/store tests stay hermetic (no live network). */
export type WeatherFetch = (url: string) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

const defaultFetch: WeatherFetch = (url) =>
  fetch(url, { headers: { accept: "application/json", "user-agent": "PUBMAXX-weather-cron/1" } });

function openMeteoUrl(lat: number, lng: number): string {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.search = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lng),
    current: "apparent_temperature,weather_code,wind_speed_10m",
    hourly: "precipitation_probability",
    forecast_hours: "1",
    forecast_days: "1",
    timezone: "Europe/London",
  }).toString();
  return url.toString();
}

/** Parse an Open-Meteo local timestamp using the response's UTC offset. */
function openMeteoLocalInstant(time: unknown, utcOffsetSeconds: unknown): number {
  if (typeof time !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(time)) return Number.NaN;
  const offset =
    typeof utcOffsetSeconds === "number" && Number.isFinite(utcOffsetSeconds)
      ? utcOffsetSeconds
      : 0;
  const sign = offset >= 0 ? "+" : "-";
  const abs = Math.abs(offset);
  const hours = String(Math.floor(abs / 3600)).padStart(2, "0");
  const minutes = String(Math.floor((abs % 3600) / 60)).padStart(2, "0");
  const normalized = time.length === 16 ? `${time}:00` : time;
  return Date.parse(`${normalized}${sign}${hours}:${minutes}`);
}

async function observationFor(
  nightArea: LondonNightAreaSlug,
  doFetch: WeatherFetch,
): Promise<NightAreaWeatherObservation | null> {
  const url = openMeteoUrl(...LONDON_NIGHT_AREA_COORDS[nightArea]);
  const response = await doFetch(url);
  if (!response.ok) throw new Error(`${nightArea}: Open-Meteo returned ${response.status}`);
  const body = (await response.json()) as {
    utc_offset_seconds?: unknown;
    current?: {
      time?: unknown;
      apparent_temperature?: unknown;
      weather_code?: unknown;
      wind_speed_10m?: unknown;
    };
    hourly?: { precipitation_probability?: unknown[] };
  };
  const observedAtMs = openMeteoLocalInstant(body?.current?.time, body?.utc_offset_seconds);
  const feelsLikeC = body?.current?.apparent_temperature;
  const weatherCode = body?.current?.weather_code;
  const windKph = body?.current?.wind_speed_10m;
  const precip = body?.hourly?.precipitation_probability?.[0];
  if (![observedAtMs, feelsLikeC, weatherCode, windKph, precip].every((v) => Number.isFinite(v as number))) {
    // Loud-but-soft: a payload that doesn't satisfy the contract is skipped,
    // never coerced into a fake reading.
    console.warn(`[weather-provider] ${nightArea}: Open-Meteo payload did not satisfy the contract — skipped.`);
    return null;
  }
  const observedAt = new Date(observedAtMs).toISOString();
  return validateWeatherObservation({
    nightArea,
    observedAt,
    expiresAt: new Date(observedAtMs + OBSERVATION_TTL_HOURS * 3_600_000).toISOString(),
    condition: conditionForCode(weatherCode as number),
    feelsLikeC,
    precipitationProbabilityPct: precip,
    windKph,
    source: { sourceUrl: url, publisher: "Open-Meteo", publishedAt: observedAt },
  });
}

export type FetchObservationsResult = {
  observations: NightAreaWeatherObservation[];
  /** Areas whose provider call failed or whose payload was dropped. */
  skipped: LondonNightAreaSlug[];
};

/**
 * Fetch a fresh observation for every night area. Per-area failures are isolated
 * (one area's provider hiccup never sinks the batch): a throw or a
 * contract-failing payload is counted in `skipped`, and the caller decides
 * whether the surviving set is worth persisting. Never persists fake data.
 */
export async function fetchNightAreaObservations(
  doFetch: WeatherFetch = defaultFetch,
): Promise<FetchObservationsResult> {
  const settled = await Promise.allSettled(
    LONDON_NIGHT_AREA_SLUGS.map((slug) => observationFor(slug, doFetch)),
  );
  const observations: NightAreaWeatherObservation[] = [];
  const skipped: LondonNightAreaSlug[] = [];
  settled.forEach((outcome, index) => {
    const slug = LONDON_NIGHT_AREA_SLUGS[index];
    if (outcome.status === "fulfilled" && outcome.value) {
      observations.push(outcome.value);
    } else {
      if (outcome.status === "rejected") {
        console.warn(`[weather-provider] ${slug}: ${outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason)}`);
      }
      skipped.push(slug);
    }
  });
  return { observations, skipped };
}
