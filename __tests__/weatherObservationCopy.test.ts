import { describe, expect, it } from "vitest";

import { formatWeatherObservationFacts, observationFacts } from "@/lib/weatherObservationCopy";

const NOW = new Date("2026-09-24T13:30:00.000Z");

describe("formatWeatherObservationFacts", () => {
  it("prints temp, rain, wind, sunset and daylight with real numbers", () => {
    const line = formatWeatherObservationFacts({
      feelsLikeC: 17.2,
      condition: "Cloudy",
      precipitationProbabilityPct: 22,
      windKph: 14.4,
      isDay: true,
      sunsetAt: "2026-09-24T17:54:00.000Z",
      now: NOW,
    });
    expect(line).toContain("Feels like 17°C");
    expect(line).toContain("cloudy");
    expect(line).toContain("22% chance of rain");
    expect(line).toContain("14 km/h wind");
    expect(line).toContain("sunset");
    expect(line).toContain("daylight");
  });

  it("labels stale readings plainly instead of guessing", () => {
    const line = formatWeatherObservationFacts({
      feelsLikeC: 9,
      condition: "Rain",
      precipitationProbabilityPct: 80,
      windKph: 28,
      isDay: false,
      sunsetAt: "2026-09-24T17:54:00.000Z",
      now: NOW,
      stale: true,
    });
    expect(line).toBe("Last read of the sky: feels like 9°C, rain, 80% chance of rain, 28 km/h wind.");
  });

  it("puts the feels-like value after the words, never before them", () => {
    const line = formatWeatherObservationFacts({
      feelsLikeC: 18.7,
      condition: "Cloudy",
      precipitationProbabilityPct: 10,
      windKph: null,
      isDay: true,
      sunsetAt: null,
      now: NOW,
    });
    expect(line).toBe("Feels like 19°C, cloudy, 10% chance of rain, daylight.");
    expect(line).not.toMatch(/°C feels like/);
  });
});

describe("observationFacts", () => {
  it("keeps an old day's sunset and darkness off a stale reading", () => {
    // Observed 01:45 BST on 3 Sept, read at 09:30 BST on 25 Sept: that night's
    // sunset and darkness must not sit beside today's date.
    const facts = observationFacts({
      observation: {
        feelsLikeC: 19,
        condition: "Cloudy",
        precipitationProbabilityPct: 6,
        windKph: 14,
        observedAt: "2026-09-03T00:45:00.000Z",
      },
      nightArea: "shoreditch",
      now: new Date("2026-09-25T08:30:00.000Z"),
      stale: true,
    });
    expect(facts.factsLine).toBe("Last read of the sky: feels like 19°C, cloudy, 6% chance of rain, 14 km/h wind.");
    expect(facts.isDay).toBeNull();
    expect(facts.checkedLabel).toBe("Last checked 22 days ago");
  });

  it("still gives a fresh reading its render-time sunset and daylight", () => {
    const facts = observationFacts({
      observation: {
        feelsLikeC: 16,
        condition: "Clear",
        precipitationProbabilityPct: 0,
        windKph: 9,
        observedAt: "2026-09-25T08:15:00.000Z",
      },
      nightArea: "shoreditch",
      now: new Date("2026-09-25T08:30:00.000Z"),
      stale: false,
    });
    expect(facts.factsLine).toMatch(/^Feels like 16°C, clear, 0% chance of rain, 9 km\/h wind, sunset \d{2}:\d{2}, daylight\.$/);
    expect(facts.isDay).toBe(true);
  });
});
