import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import VenueWeatherRecommendations, {
  WeatherRecommendationList,
  readWeatherRecommendationVenueLoad,
} from "@/components/map/VenueWeatherRecommendations";
import type { WeatherRecommendation } from "@/lib/weatherRecommendations";

function recommendation(
  overrides: Partial<WeatherRecommendation> = {},
): WeatherRecommendation {
  return {
    id: "recommendation-1",
    venueId: "venue-1",
    condition: "warm",
    reason: "The back garden catches the evening light.",
    contributorHandle: "night_owl",
    submittedAt: Date.parse("2026-07-28T19:00:00.000Z"),
    source: "community",
    ...overrides,
  };
}

describe("WeatherRecommendationList", () => {
  it("renders each row as a named Pubmaxxer's opinion", () => {
    const html = renderToStaticMarkup(
      createElement(WeatherRecommendationList, {
        venueName: "The Crown",
        recommendations: [recommendation()],
        weatherStatus: "available",
        degraded: false,
        truncated: false,
      }),
    );

    expect(html).toContain("Fits tonight");
    expect(html).toContain("@night_owl");
    expect(html).toContain("recommends this when it’s warm");
    expect(html).toContain("The back garden catches the evening light.");
    expect(html).not.toContain("verified");
    expect(html).not.toContain("score");
    expect(html).not.toContain("rank");
  });

  it("states weather failure and still renders authored rows", () => {
    const html = renderToStaticMarkup(
      createElement(WeatherRecommendationList, {
        venueName: "The Crown",
        recommendations: [recommendation({ condition: "cold" })],
        weatherStatus: "unavailable",
        degraded: false,
        truncated: false,
      }),
    );

    expect(html).toContain("We couldn’t check the weather here just now.");
    expect(html).toContain("shown without a weather match");
    expect(html).toContain("The back garden catches the evening light.");
  });

  it("keeps a degraded recommendation read distinct from no opinions", () => {
    const html = renderToStaticMarkup(
      createElement(WeatherRecommendationList, {
        venueName: "The Crown",
        recommendations: [],
        weatherStatus: "available",
        degraded: true,
        truncated: false,
      }),
    );

    expect(html).toContain(
      "We couldn’t read every recommendation here just now.",
    );
    expect(html).not.toContain("No recommendations");
  });
});

describe("VenueWeatherRecommendations", () => {
  it("renders the five-condition authoring flow with labelled bounded fields", () => {
    const html = renderToStaticMarkup(
      createElement(VenueWeatherRecommendations, {
        venueId: "venue-1",
        venueName: "The Crown",
      }),
    );

    expect(html).toContain('role="radiogroup"');
    expect((html.match(/role="radio"/g) ?? [])).toHaveLength(5);
    expect(html).toContain("Clear skies");
    expect(html).toContain('aria-label="Your Pubmaxx handle"');
    expect(html).toContain('maxLength="30"');
    expect(html).toContain(
      'aria-label="Why The Crown suits this weather"',
    );
    expect(html).toContain('maxLength="160"');
    expect(html).toContain("Recommend it");
  });
});

describe("readWeatherRecommendationVenueLoad", () => {
  it("accepts the bounded server payload and drops no attribution", () => {
    expect(
      readWeatherRecommendationVenueLoad({
        weatherStatus: "available",
        matchingConditions: ["warm", "clear"],
        recommendations: [recommendation()],
        degraded: false,
        truncated: false,
      }),
    ).toEqual({
      status: "ready",
      value: {
        weatherStatus: "available",
        matchingConditions: ["warm", "clear"],
        recommendations: [recommendation()],
        degraded: false,
        truncated: false,
      },
    });
  });

  it("rejects malformed payloads instead of rendering them as an empty venue", () => {
    expect(
      readWeatherRecommendationVenueLoad({
        weatherStatus: "available",
        matchingConditions: ["warm"],
        recommendations: [{ condition: "snowy" }],
      }),
    ).toEqual({ status: "invalid" });
  });
});
