import { describe, expect, it } from "vitest";

import {
  TONIGHT_AGENT_NEXT_STEP,
  interpretTonightAgentGenerateBody,
  tonightInviteDraft,
} from "@/lib/tonightAgent";

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

  it("builds an invite draft from grounded generate stops", () => {
    const result = interpretTonightAgentGenerateBody(
      true,
      {
        grounded: true,
        stops: [
          { venueId: "venue-a", venueName: "The A", estimatedPintPricePence: 450 },
          { venueId: "venue-b", venueName: "The B", estimatedPintPricePence: null },
          { venueId: "venue-c", venueName: "The C", estimatedPintPricePence: 520 },
        ],
      },
      { title: "Quiet in Clapham for 4" },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.stops).toHaveLength(3);
    expect(result.stops[0]?.priceGbp).toBe(4.5);
    expect(result.stops[1]?.priceGbp).toBeNull();
    expect(result.inviteDraft).toContain("Quiet in Clapham for 4 · 3 stops");
    expect(result.nextStep).toBe(TONIGHT_AGENT_NEXT_STEP);
  });

  it("treats fewer than three stops as scarcity", () => {
    const result = interpretTonightAgentGenerateBody(true, {
      stops: [{ venueId: "venue-a", venueName: "Only one" }],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe("scarcity");
  });
});
