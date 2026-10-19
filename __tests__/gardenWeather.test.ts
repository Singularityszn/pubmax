import { describe, expect, it } from "vitest";

import {
  MAX_PRECIP_PROBABILITY_PCT,
  MIN_FEELS_LIKE_C,
  gardenWeatherHeadline,
  isGardenWeather,
  type GardenWeatherInput,
} from "@/lib/gardenWeather";

// A positive garden-weather answer needs every reading known: a finite
// feels-like, a finite rain chance inside 0..100 and an explicit daylight
// flag. A warm number alone is no evidence of a dry or daylit evening, and
// a low rain chance is a forecast, never a promise of dry weather.

describe("isGardenWeather", () => {
  it("passes on a warm dry day", () => {
    expect(
      isGardenWeather({ feelsLikeC: 24, precipProbabilityPct: 5, isDay: true }),
    ).toBe(true);
  });

  it("passes at exactly the feels-like threshold", () => {
    expect(
      isGardenWeather({
        feelsLikeC: MIN_FEELS_LIKE_C,
        precipProbabilityPct: 0,
        isDay: true,
      }),
    ).toBe(true);
  });

  it("fails just below the feels-like threshold", () => {
    expect(
      isGardenWeather({
        feelsLikeC: MIN_FEELS_LIKE_C - 0.5,
        precipProbabilityPct: 0,
        isDay: true,
      }),
    ).toBe(false);
  });

  it("passes just below the precip threshold", () => {
    expect(
      isGardenWeather({
        feelsLikeC: 22,
        precipProbabilityPct: MAX_PRECIP_PROBABILITY_PCT - 1,
        isDay: true,
      }),
    ).toBe(true);
  });

  it("fails at exactly the precip threshold", () => {
    expect(
      isGardenWeather({
        feelsLikeC: 22,
        precipProbabilityPct: MAX_PRECIP_PROBABILITY_PCT,
        isDay: true,
      }),
    ).toBe(false);
  });

  it("fails when it is explicitly night", () => {
    expect(
      isGardenWeather({ feelsLikeC: 22, precipProbabilityPct: 5, isDay: false }),
    ).toBe(false);
  });

  it("fails when feels-like is missing or non-finite", () => {
    expect(isGardenWeather({ precipProbabilityPct: 5, isDay: true })).toBe(false);
    expect(isGardenWeather({ feelsLikeC: Number.NaN, isDay: true })).toBe(false);
    expect(isGardenWeather(null)).toBe(false);
    expect(isGardenWeather(undefined)).toBe(false);
  });

  it.each<[string, GardenWeatherInput]>([
    ["the rain chance is omitted", { feelsLikeC: 20, isDay: true }],
    ["the rain chance is null", { feelsLikeC: 20, precipProbabilityPct: null, isDay: true }],
    ["the rain chance is NaN", { feelsLikeC: 20, precipProbabilityPct: Number.NaN, isDay: true }],
    ["the rain chance is +Infinity", { feelsLikeC: 20, precipProbabilityPct: Number.POSITIVE_INFINITY, isDay: true }],
    ["the rain chance is -Infinity", { feelsLikeC: 20, precipProbabilityPct: Number.NEGATIVE_INFINITY, isDay: true }],
    ["the rain chance is below 0%", { feelsLikeC: 20, precipProbabilityPct: -1, isDay: true }],
    ["the rain chance is above 100%", { feelsLikeC: 20, precipProbabilityPct: 101, isDay: true }],
    ["the rain chance is a string", { feelsLikeC: 20, precipProbabilityPct: "10" as unknown as number, isDay: true }],
    ["daylight is omitted", { feelsLikeC: 18, precipProbabilityPct: 10 }],
    ["daylight is null", { feelsLikeC: 18, precipProbabilityPct: 10, isDay: null }],
    ["daylight is a string", { feelsLikeC: 18, precipProbabilityPct: 10, isDay: "true" as unknown as boolean }],
    ["daylight is a number", { feelsLikeC: 18, precipProbabilityPct: 10, isDay: 1 as unknown as boolean }],
    ["feels-like is +Infinity", { feelsLikeC: Number.POSITIVE_INFINITY, precipProbabilityPct: 10, isDay: true }],
  ])("fails closed when %s", (_label, weather) => {
    expect(isGardenWeather(weather)).toBe(false);
    expect(gardenWeatherHeadline(weather)).toBeNull();
  });
});

describe("gardenWeatherHeadline", () => {
  it("rounds the temperature into the headline", () => {
    expect(
      gardenWeatherHeadline({
        feelsLikeC: 23.6,
        precipProbabilityPct: 10,
        isDay: true,
      }),
    ).toBe("Feels like 24°C, 10% chance of rain. Beer-garden weather.");
  });

  it("states a known rain chance as a chance, never as dry or sunny", () => {
    for (const pct of [0, 5, MAX_PRECIP_PROBABILITY_PCT - 1]) {
      const headline = gardenWeatherHeadline({
        feelsLikeC: 20,
        precipProbabilityPct: pct,
        isDay: true,
      });
      expect(headline).toBe(`Feels like 20°C, ${pct}% chance of rain. Beer-garden weather.`);
      expect(headline).not.toMatch(/\b(dry|sun|sunny|sunshine|shade|seat)\b/i);
    }
  });

  it("never calls an unknown rain chance dry", () => {
    const headline = gardenWeatherHeadline({ feelsLikeC: 20, isDay: true });
    expect(headline ?? "").not.toMatch(/\bdry\b/i);
    expect(headline).toBeNull();
  });

  it("returns null when it is not garden weather", () => {
    expect(
      gardenWeatherHeadline({
        feelsLikeC: 10,
        precipProbabilityPct: 10,
        isDay: true,
      }),
    ).toBeNull();
    expect(gardenWeatherHeadline(null)).toBeNull();
  });
});
