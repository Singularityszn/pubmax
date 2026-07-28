import { beforeEach, describe, expect, it } from "vitest";

import {
  __resetWeatherRecommendations,
  MAX_WEATHER_RECOMMENDATIONS_PER_VENUE,
  memoryWeatherRecommendationStore,
} from "@/lib/weatherRecommendationStore";
import type {
  WeatherRecommendationCondition,
  WeatherRecommendationInput,
} from "@/lib/weatherRecommendations";

function input(
  overrides: Partial<WeatherRecommendationInput> = {},
): WeatherRecommendationInput & { actorHash: string } {
  return {
    venueId: "venue-1",
    condition: "warm",
    reason: "The back garden catches the evening light.",
    contributorHandle: "night_owl",
    actorHash: "actor-a",
    ...overrides,
  };
}

describe("memoryWeatherRecommendationStore", () => {
  beforeEach(() => {
    __resetWeatherRecommendations();
  });

  it("upserts one opinion per venue, condition, and contributor", async () => {
    const first = await memoryWeatherRecommendationStore.create(
      input({ reason: "The first useful reason here." }),
      1_000,
    );
    const updated = await memoryWeatherRecommendationStore.create(
      input({
        reason: "The better useful reason here.",
        actorHash: "actor-b",
      }),
      2_000,
    );

    const read = await memoryWeatherRecommendationStore.listForVenue("venue-1");
    expect(read).toEqual({
      status: "ready",
      recommendations: [updated],
    });
    expect(updated.id).toBe(first.id);
    expect(updated.reason).toBe("The better useful reason here.");
    expect(updated.submittedAt).toBe(2_000);
    expect(updated).not.toHaveProperty("actorHash");
  });

  it("keeps separate weather opinions from one contributor countable", async () => {
    await memoryWeatherRecommendationStore.create(input(), 1_000);
    await memoryWeatherRecommendationStore.create(
      input({
        venueId: "venue-2",
        condition: "cold",
        reason: "The snug is made for a cold evening.",
      }),
      2_000,
    );

    expect(
      await memoryWeatherRecommendationStore.countForContributor("night_owl"),
    ).toEqual({ status: "ready", count: 2 });
    expect(
      await memoryWeatherRecommendationStore.countForContributor(
        "someone_else",
      ),
    ).toEqual({ status: "ready", count: 0 });
  });

  it("bounds a venue read to the newest rows without exposing actor hashes", async () => {
    const conditions: WeatherRecommendationCondition[] = [
      "warm",
      "clear",
      "raining",
      "cold",
      "windy",
    ];
    for (let index = 0; index < 25; index += 1) {
      await memoryWeatherRecommendationStore.create(
        input({
          condition: conditions[index % conditions.length],
          contributorHandle: `person_${index}`,
          actorHash: `actor-${index}`,
        }),
        index * 1_000,
      );
    }

    const read = await memoryWeatherRecommendationStore.listForVenue("venue-1");
    expect(read.recommendations).toHaveLength(
      MAX_WEATHER_RECOMMENDATIONS_PER_VENUE,
    );
    expect(read.recommendations[0]?.contributorHandle).toBe("person_24");
    expect(read.recommendations.at(-1)?.contributorHandle).toBe("person_5");
    expect(JSON.stringify(read)).not.toContain("actor-");
  });

  it("returns a defensive copy instead of mutable store state", async () => {
    const created = await memoryWeatherRecommendationStore.create(input(), 1_000);
    created.reason = "Mutated outside the store.";

    const read = await memoryWeatherRecommendationStore.listForVenue("venue-1");
    expect(read.recommendations[0]?.reason).toBe(
      "The back garden catches the evening light.",
    );
  });
});
