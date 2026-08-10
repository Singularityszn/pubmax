import { describe, expect, it } from "vitest";

import {
  buildTonightAgentGenerateBody,
  TONIGHT_AGENT_NEXT_STEP,
  interpretTonightAgentGenerateBody,
  tonightInviteDraft,
  tonightStopPriceCaption,
  type TonightAgentStop,
} from "@/lib/tonightAgent";

const NOW = Date.parse("2026-08-08T20:00:00.000Z");

const groundedEvidence = {
  pence: 450,
  source: {
    label: "The Beer Guide",
    url: "https://example.com/prices",
    observedAt: "2026-08-01T18:00:00.000Z",
  },
  confidenceState: "fresh" as const,
};

describe("tonightInviteDraft", () => {
  it("reuses the honest plan invite share text", () => {
    expect(
      tonightInviteDraft({
        title: "Friday in Soho",
        stopCount: 3,
        startClock: "19:00",
      }),
    ).toBe("Friday in Soho · 3 stops · starts 19:00. Open the link and tap I'm in.");
  });
});

describe("buildTonightAgentGenerateBody", () => {
  it("sends a trimmed query with every unanswered intake step marked skipped", () => {
    expect(buildTonightAgentGenerateBody("  Step-free in Camden  ")).toMatchObject({
      query: "Step-free in Camden",
      intake: {
        version: 1,
        accessibilityNeeds: [],
        skipped: expect.arrayContaining(["accessibility"]),
      },
    });
  });
});

describe("interpretTonightAgentGenerateBody", () => {
  it("fails closed on scarcity 422 without inventing stops", () => {
    const result = interpretTonightAgentGenerateBody(false, {
      error: "No three-stop route in Clapham meets every must-have need with the information available.",
      code: "GROUNDED_CONSTRAINTS_UNSATISFIED",
    });
    expect(result).toEqual({
      ok: false,
      kind: "scarcity",
      message:
        "No three-stop route in Clapham meets every must-have need with the information available.",
      code: "GROUNDED_CONSTRAINTS_UNSATISFIED",
    });
  });

  it("reads scarcity from every honest 422 code the route answers", () => {
    for (const code of [
      "GROUNDED_VENUES_INSUFFICIENT",
      "NIGHT_AREA_REQUIRED",
      "NIGHT_AREA_CITY_MISMATCH",
      "NIGHT_AREA_CONSTRAINT_BLOCKED",
      "NIGHT_PATCH_UNSUPPORTED",
    ]) {
      const result = interpretTonightAgentGenerateBody(false, {
        error: "Choose an area.",
        code,
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.kind).toBe("scarcity");
    }
  });

  it("keeps non-scarcity server errors as errors with the server's message", () => {
    const result = interpretTonightAgentGenerateBody(false, {
      error: "Too many requests.",
      code: "RATE_LIMITED",
    });
    expect(result).toEqual({
      ok: false,
      kind: "error",
      message: "Too many requests.",
      code: "RATE_LIMITED",
    });
  });

  it("maps the route's stop rows, carrying price evidence through", () => {
    const result = interpretTonightAgentGenerateBody(
      true,
      {
        grounded: true,
        stops: [
          {
            venueId: "venue-a",
            venueName: "The A",
            estimatedPintPricePence: 450,
            priceEvidence: groundedEvidence,
          },
          {
            venueId: "venue-b",
            venueName: "The B",
            estimatedPintPricePence: null,
            priceEvidence: null,
          },
          {
            venueId: "venue-c",
            venueName: "The C",
            estimatedPintPricePence: 520,
            priceEvidence: null,
          },
        ],
      },
      { title: "Quiet in Clapham for 4" },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.stops).toEqual([
      {
        venueId: "venue-a",
        name: "The A",
        pricePence: 450,
        priceEvidence: groundedEvidence,
      },
      { venueId: "venue-b", name: "The B", pricePence: null, priceEvidence: null },
      { venueId: "venue-c", name: "The C", pricePence: 520, priceEvidence: null },
    ]);
    expect(result.inviteDraft).toContain("Quiet in Clapham for 4 · 3 stops");
    expect(result.nextStep).toBe(TONIGHT_AGENT_NEXT_STEP);
  });

  it("drops malformed price evidence rather than dressing the figure", () => {
    const result = interpretTonightAgentGenerateBody(true, {
      stops: [
        {
          venueId: "venue-a",
          venueName: "The A",
          estimatedPintPricePence: 450,
          // Evidence for a different figure than the one we would print.
          priceEvidence: { ...groundedEvidence, pence: 400 },
        },
        {
          venueId: "venue-b",
          venueName: "The B",
          estimatedPintPricePence: 500,
          priceEvidence: { pence: 500, source: null, confidenceState: "unknown" },
        },
        {
          venueId: "venue-c",
          venueName: "The C",
          estimatedPintPricePence: 520,
          priceEvidence: { ...groundedEvidence, pence: 520, confidenceState: "vibes" },
        },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.stops.map((stop) => stop.priceEvidence)).toEqual([null, null, null]);
  });

  it("adds a spend band to the invite draft only when every stop price is listed", () => {
    const complete = interpretTonightAgentGenerateBody(
      true,
      {
        stops: [
          { venueId: "venue-a", venueName: "The A", estimatedPintPricePence: 450, priceEvidence: null },
          { venueId: "venue-b", venueName: "The B", estimatedPintPricePence: 500, priceEvidence: null },
          { venueId: "venue-c", venueName: "The C", estimatedPintPricePence: 620, priceEvidence: null },
        ],
      },
      { title: "Quiet in Clapham for 4" },
    );
    expect(complete.ok).toBe(true);
    if (!complete.ok) return;
    expect(complete.inviteDraft).toContain("£4.50–£6.20 per person");

    const incomplete = interpretTonightAgentGenerateBody(
      true,
      {
        stops: [
          { venueId: "venue-a", venueName: "The A", estimatedPintPricePence: 450, priceEvidence: null },
          { venueId: "venue-b", venueName: "The B", estimatedPintPricePence: null, priceEvidence: null },
          { venueId: "venue-c", venueName: "The C", estimatedPintPricePence: 620, priceEvidence: null },
        ],
      },
      { title: "Quiet in Clapham for 4" },
    );
    expect(incomplete.ok).toBe(true);
    if (!incomplete.ok) return;
    expect(incomplete.inviteDraft).not.toContain("per person");
  });

  it("treats an unrecognised 200 shape as an error, never a scarcity verdict", () => {
    for (const body of [
      { stops: [{ venueId: "venue-a", venueName: "Only one", estimatedPintPricePence: null, priceEvidence: null }] },
      { stops: "not-an-array" },
      { route: { stops: [] } },
      {
        stops: [
          { venueId: "venue-a", venueName: "The A", estimatedPintPricePence: null, priceEvidence: null },
          { venueId: "venue-b", estimatedPintPricePence: null, priceEvidence: null },
          { venueId: "venue-c", venueName: "The C", estimatedPintPricePence: null, priceEvidence: null },
        ],
      },
    ]) {
      const result = interpretTonightAgentGenerateBody(true, body);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.kind).toBe("error");
      expect(result.code).toBeUndefined();
      expect(result.message).toBe("PUBMAXX couldn't sort this one.");
    }
  });
});

describe("tonightStopPriceCaption", () => {
  const stop = (overrides: Partial<TonightAgentStop>): TonightAgentStop => ({
    venueId: "venue-a",
    name: "The A",
    pricePence: 450,
    priceEvidence: null,
    ...overrides,
  });

  it("names the source and the day it was seen for a grounded figure", () => {
    expect(
      tonightStopPriceCaption(stop({ priceEvidence: groundedEvidence }), NOW),
    ).toBe("The Beer Guide · 1 Aug");
  });

  it("says plainly when no publisher is recorded for the figure", () => {
    expect(tonightStopPriceCaption(stop({}), NOW)).toBe("no publisher recorded");
  });

  it("captions nothing when there is no figure", () => {
    expect(tonightStopPriceCaption(stop({ pricePence: null }), NOW)).toBeNull();
  });
});
