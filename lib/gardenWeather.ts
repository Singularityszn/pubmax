// Beer-garden weather heuristic — pure, no fetch, no React. The /discover
// GardenTonightCard feeds this the /api/citymcp/status weather block and only
// renders when it says yes. Honest empty: missing data means NOT garden
// weather (we never invent sunshine). A rain chance is a forecast, so a low
// one is printed as a chance and never as "dry".

export const MIN_FEELS_LIKE_C = 16;
export const MAX_PRECIP_PROBABILITY_PCT = 40;

export type GardenWeatherInput = {
  feelsLikeC?: number | null;
  precipProbabilityPct?: number | null;
  isDay?: boolean | null;
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isKnownPercent(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0 && value <= 100;
}

/**
 * True when it's decent beer-garden weather:
 *  - feels-like is known and >= MIN_FEELS_LIKE_C
 *  - precip probability is known, inside 0..100, and < MAX_PRECIP_PROBABILITY_PCT
 *  - it is known to be daytime (isDay === true)
 * Any missing, null, non-finite or malformed reading → false: we never guess
 * warmth, a dry sky or daylight.
 */
export function isGardenWeather(
  weather: GardenWeatherInput | null | undefined,
): boolean {
  if (!weather) return false;
  if (!isFiniteNumber(weather.feelsLikeC)) return false;
  if (weather.feelsLikeC < MIN_FEELS_LIKE_C) return false;
  if (!isKnownPercent(weather.precipProbabilityPct)) return false;
  if (weather.precipProbabilityPct >= MAX_PRECIP_PROBABILITY_PCT) return false;
  if (weather.isDay !== true) return false;
  return true;
}

/**
 * Headline for the nudge card, e.g. "Feels like 24°C, 10% chance of rain.
 * Beer-garden weather.".
 * Returns null when it isn't garden weather (callers render nothing).
 */
export function gardenWeatherHeadline(
  weather: GardenWeatherInput | null | undefined,
): string | null {
  if (!weather || !isGardenWeather(weather)) return null;
  if (
    !isFiniteNumber(weather.feelsLikeC) ||
    !isKnownPercent(weather.precipProbabilityPct)
  ) {
    return null;
  }
  return `Feels like ${Math.round(weather.feelsLikeC)}°C, ${Math.round(weather.precipProbabilityPct)}% chance of rain. Beer-garden weather.`;
}
