import { describe, expect, it } from "vitest";

import { formatWeatherObservationFacts } from "@/lib/weatherObservationCopy";

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
    expect(line).toContain("17°C feels like");
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
      sunsetAt: null,
      now: NOW,
      stale: true,
    });
    expect(line.startsWith("Last read of the sky:")).toBe(true);
    expect(line).toContain("night");
    expect(line).not.toMatch(/beer garden/i);
  });
});
