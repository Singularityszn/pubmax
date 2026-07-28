import { describe, expect, it } from "vitest";

import {
  conditionsForWeather,
  isWeatherRecommendationCondition,
  matchingWeatherRecommendations,
  validateWeatherRecommendation,
  WEATHER_RECOMMENDATION_CONDITIONS,
  type WeatherRecommendation,
  type WeatherRecommendationCondition,
} from "@/lib/weatherRecommendations";

function recommendation(
  condition: WeatherRecommendationCondition,
): WeatherRecommendation {
  return {
    id: `recommendation-${condition}`,
    venueId: "venue-1",
    condition,
    reason: `${condition} reason worth sharing.`,
    contributorHandle: "night_owl",
    submittedAt: 1_000,
    source: "community",
  };
}

describe("validateWeatherRecommendation", () => {
  it("normalises one authored recommendation", () => {
    expect(
      validateWeatherRecommendation({
        venueId: " venue-1 ",
        condition: "WARM",
        reason: "  The back garden catches   the last of the light. ",
        contributorHandle: "@Night_Owl",
      }),
    ).toEqual({
      ok: true,
      value: {
        venueId: "venue-1",
        condition: "warm",
        reason: "The back garden catches the last of the light.",
        contributorHandle: "night_owl",
      },
    });
  });

  it("rejects an open-ended condition", () => {
    expect(
      validateWeatherRecommendation({
        venueId: "venue-1",
        condition: "snowy",
        reason: "Good when snow settles.",
        contributorHandle: "night_owl",
      }),
    ).toEqual({ ok: false, error: "Pick the weather this suits." });
  });

  it("requires a venue, contributor, and short specific reason", () => {
    expect(
      validateWeatherRecommendation({
        condition: "warm",
        reason: "The garden stays bright.",
        contributorHandle: "night_owl",
      }),
    ).toEqual({ ok: false, error: "A venue is required." });
    expect(
      validateWeatherRecommendation({
        venueId: "venue-1",
        condition: "warm",
        reason: "The garden stays bright.",
        contributorHandle: "",
      }),
    ).toEqual({ ok: false, error: "Add your Pubmaxx handle." });
    expect(
      validateWeatherRecommendation({
        venueId: "venue-1",
        condition: "warm",
        reason: "Nice.",
        contributorHandle: "night_owl",
      }),
    ).toEqual({
      ok: false,
      error: "Say why in at least 8 characters.",
    });
  });

  it("counts Unicode code points exactly as the durable database does", () => {
    expect(
      validateWeatherRecommendation({
        venueId: "venue-1",
        condition: "warm",
        reason: "🍺🍺🍺🍺",
        contributorHandle: "night_owl",
      }),
    ).toEqual({
      ok: false,
      error: "Say why in at least 8 characters.",
    });

    const capped = validateWeatherRecommendation({
      venueId: "venue-1",
      condition: "warm",
      reason: "🍺".repeat(200),
      contributorHandle: "night_owl",
    });
    expect(capped.ok).toBe(true);
    if (capped.ok) {
      expect([...capped.value.reason]).toHaveLength(160);
      expect(capped.value.reason).not.toContain("�");
    }
  });

  it("removes markup and control characters before storing the opinion", () => {
    const result = validateWeatherRecommendation({
      venueId: "venue-1",
      condition: "cold",
      reason: "<b>Fire\u0000 in the snug</b>",
      contributorHandle: "night_owl",
    });
    expect(result).toEqual({
      ok: true,
      value: {
        venueId: "venue-1",
        condition: "cold",
        reason: "bFire in the snug/b",
        contributorHandle: "night_owl",
      },
    });
  });
});

describe("isWeatherRecommendationCondition", () => {
  it("accepts only stored closed-set values, not unnormalised lookalikes", () => {
    expect(isWeatherRecommendationCondition("warm")).toBe(true);
    expect(isWeatherRecommendationCondition("WARM")).toBe(false);
  });
});

describe("conditionsForWeather", () => {
  it("uses a five-condition vocabulary that the existing snapshot supports", () => {
    expect(WEATHER_RECOMMENDATION_CONDITIONS).toEqual([
      "warm",
      "clear",
      "raining",
      "cold",
      "windy",
    ]);
  });

  it("derives overlapping warm, clear, and windy conditions", () => {
    expect(
      conditionsForWeather({
        condition: "Clear",
        feelsLikeC: 20,
        precipitationProbabilityPct: 5,
        windKph: 36,
      }),
    ).toEqual(["warm", "clear", "windy"]);
  });

  it("recognises rain from either probability or current condition", () => {
    expect(
      conditionsForWeather({
        condition: "Cloudy",
        feelsLikeC: 12,
        precipitationProbabilityPct: 60,
        windKph: 8,
      }),
    ).toEqual(["raining"]);
    expect(
      conditionsForWeather({
        condition: "Drizzle",
        feelsLikeC: 12,
        precipitationProbabilityPct: 20,
        windKph: null,
      }),
    ).toEqual(["raining"]);
  });

  it("keeps cold and windy independent", () => {
    expect(
      conditionsForWeather({
        condition: "Cloudy",
        feelsLikeC: 7.9,
        precipitationProbabilityPct: 10,
        windKph: 30,
      }),
    ).toEqual(["cold", "windy"]);
  });

  it("does not invent a match from malformed weather", () => {
    expect(
      conditionsForWeather({
        condition: "Clear",
        feelsLikeC: Number.NaN,
        precipitationProbabilityPct: 5,
        windKph: 2,
      }),
    ).toEqual([]);
  });
});

describe("matchingWeatherRecommendations", () => {
  it("filters authored opinions by current conditions without ranking them", () => {
    const rows = [
      recommendation("cold"),
      recommendation("warm"),
      recommendation("clear"),
    ];
    expect(
      matchingWeatherRecommendations(rows, ["warm", "clear"]).map(
        (row) => row.condition,
      ),
    ).toEqual(["warm", "clear"]);
  });
});
