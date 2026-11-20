// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import VenueWeatherRecommendations, {
  WeatherRecommendationList,
  readWeatherRecommendationVenueLoad,
} from "@/components/map/VenueWeatherRecommendations";
import type { WeatherRecommendation } from "@/lib/weatherRecommendations";

const authState = vi.hoisted(() => ({
  user: { id: "account-1" } as { id: string } | null,
  session: {
    access_token: "session-token",
    user: { id: "account-1" },
  } as { access_token: string; user: { id: string } } | null,
  handle: "night_owl" as string | null,
}));

vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => ({
    user: authState.user,
    session: authState.session,
    handle: authState.handle,
  }),
}));
vi.mock("@/lib/useStaggeredRead", () => ({ useStaggeredRead: () => true }));

beforeEach(() => {
  authState.user = { id: "account-1" };
  authState.session = {
    access_token: "session-token",
    user: { id: "account-1" },
  };
  authState.handle = "night_owl";
});

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

type WeatherRecommendationListProps = Parameters<
  typeof WeatherRecommendationList
>[0];

function listMarkup(
  props: Partial<WeatherRecommendationListProps> = {},
): string {
  return renderToStaticMarkup(
    createElement(WeatherRecommendationList, {
      venueName: "The Crown",
      recommendations: [],
      weatherStatus: "available",
      matchingConditions: ["warm"],
      degraded: false,
      truncated: false,
      ...props,
    }),
  );
}

describe("WeatherRecommendationList", () => {
  it("renders each row as a named Pubmaxxer's opinion", () => {
    const html = listMarkup({ recommendations: [recommendation()] });

    expect(html).toContain("Fits tonight");
    expect(html).toContain("@night_owl");
    expect(html).toContain("recommends this when it’s warm");
    expect(html).toContain("The back garden catches the evening light.");
    expect(html).not.toContain("verified");
    expect(html).not.toContain("score");
    expect(html).not.toContain("rank");
  });

  it("names the grouping on an element assistive tech reads", () => {
    expect(listMarkup({ recommendations: [recommendation()] })).toContain(
      '<section class="weatherRecRead" aria-label="Recommendations for The Crown">',
    );
  });

  it("states weather failure and still renders authored rows", () => {
    const html = listMarkup({
      recommendations: [recommendation({ condition: "cold" })],
      weatherStatus: "unavailable",
      matchingConditions: [],
    });

    expect(html).toContain("We couldn’t check the weather here just now.");
    expect(html).toContain("shown without a weather match");
    // Brand casing (captain's law, site audit 13 Sep 2026, D21).
    expect(html).toContain("These are PUBMAXXERS’ recommendations");
    expect(html).toContain("PUBMAXXERS recommend");
    expect(html).not.toContain("Pubmaxxers");
    expect(html).toContain("The back garden catches the evening light.");
  });

  it("never promises recommendations it has none of when weather fails", () => {
    const html = listMarkup({
      weatherStatus: "unavailable",
      matchingConditions: [],
    });

    expect(html).toBe("");
  });

  it("invites the first opinion when tonight is a condition anyone can author", () => {
    const html = listMarkup({ matchingConditions: ["warm", "clear"] });

    expect(html).toBe("");
  });

  it("reports weather outside the five conditions as our gap, with no invitation", () => {
    const html = listMarkup({ matchingConditions: [] });

    expect(html).toBe("");
  });

  it("keeps a degraded recommendation read distinct from no opinions", () => {
    const html = listMarkup({ degraded: true, matchingConditions: [] });

    expect(html).toContain(
      "We couldn’t read every recommendation here just now.",
    );
    expect(html).not.toContain("No recommendations");
    expect(html).not.toContain("Nobody has recommended");
    expect(html).not.toContain("We don’t have recommendations");
  });
});

describe("VenueWeatherRecommendations", () => {
  it("asks a signed-out visitor to sign in before rendering authoring fields", () => {
    authState.user = null;
    authState.session = null;
    authState.handle = null;

    const html = renderToStaticMarkup(
      createElement(VenueWeatherRecommendations, {
        venueId: "venue-1",
        venueName: "The Crown",
      }),
    );

    expect(html).toContain("Sign in to recommend for the weather");
    expect(html).not.toContain('name="condition"');
    expect(html).not.toContain('name="reason"');
  });

  it("opens the weather form from the compact action when no recommendations exist", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ weatherStatus: "available", matchingConditions: ["warm"], recommendations: [], degraded: false, truncated: false })));
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    try {
      await act(async () => root.render(createElement(VenueWeatherRecommendations, { venueId: "venue-1", venueName: "The Crown" })));
      expect(host.querySelector('textarea[name="reason"]')).toBeNull();
      const button = [...host.querySelectorAll("button")].find((item) => item.textContent === "Recommend for the weather");
      expect(button).toBeDefined();
      await act(async () => button!.click());
      expect(host.querySelectorAll('input[name="condition"]')).toHaveLength(5);
      expect(host.querySelector('textarea[aria-label="Why The Crown suits this weather"]')).not.toBeNull();
    } finally {
      await act(async () => root.unmount());
      host.remove();
      vi.unstubAllGlobals();
    }
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

  it("rejects a malformed envelope instead of rendering it as an empty venue", () => {
    expect(
      readWeatherRecommendationVenueLoad({
        matchingConditions: ["warm"],
        recommendations: [],
      }),
    ).toEqual({ status: "invalid" });
    expect(
      readWeatherRecommendationVenueLoad({
        weatherStatus: "available",
        matchingConditions: ["snowy"],
        recommendations: [],
      }),
    ).toEqual({ status: "invalid" });
  });

  it("drops one unreadable row, keeps the rest, and says the read was partial", () => {
    expect(
      readWeatherRecommendationVenueLoad({
        weatherStatus: "available",
        matchingConditions: ["warm"],
        recommendations: [{ condition: "snowy" }, recommendation()],
        degraded: false,
        truncated: false,
      }),
    ).toEqual({
      status: "ready",
      value: {
        weatherStatus: "available",
        matchingConditions: ["warm"],
        recommendations: [recommendation()],
        degraded: true,
        truncated: false,
      },
    });
  });
});
