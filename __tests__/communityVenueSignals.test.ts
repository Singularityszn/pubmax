import { describe, expect, it } from "vitest";

import {
  COMMUNITY_VENUE_SIGNAL_OPTIONS,
  communityVenueSignalText,
  isAccessSignalKey,
  validateCommunityVenueSignal,
  type CommunityVenueSignal,
  type CommunityVenueSignalKey,
  type CommunityVenueSignalValue,
} from "@/lib/communityVenueSignals";
import { COMMUNITY_PRICE_MAX_AGE_MS } from "@/lib/communityPrice";

const NOW = Date.parse("2026-07-28T20:00:00Z");

function signal(
  signalKey: CommunityVenueSignalKey,
  signalValue: CommunityVenueSignalValue,
  overrides: Partial<CommunityVenueSignal> = {},
): CommunityVenueSignal {
  return {
    venueId: "venue-xjf3n0",
    signalKey,
    signalValue,
    submittedAt: NOW,
    source: "community",
    corroborations: 1,
    ...overrides,
  };
}

describe("validateCommunityVenueSignal", () => {
  it("accepts every value offered for its own question", () => {
    for (const [signalKey, options] of Object.entries(
      COMMUNITY_VENUE_SIGNAL_OPTIONS,
    )) {
      for (const option of options) {
        expect(
          validateCommunityVenueSignal({
            venueId: "venue-xjf3n0",
            signalKey,
            signalValue: option.value,
          }),
        ).toEqual({
          ok: true,
          value: {
            venueId: "venue-xjf3n0",
            signalKey,
            signalValue: option.value,
          },
        });
      }
    }
  });

  it("rejects a value belonging to another question", () => {
    expect(
      validateCommunityVenueSignal({
        venueId: "venue-xjf3n0",
        signalKey: "character",
        signalValue: "step-free",
      }),
    ).toEqual({
      ok: false,
      error: "Pick what you noticed.",
    });
  });

  it("requires a known question and venue", () => {
    expect(
      validateCommunityVenueSignal({
        venueId: "",
        signalKey: "character",
        signalValue: "rough",
      }),
    ).toEqual({ ok: false, error: "A venue is required." });
    expect(
      validateCommunityVenueSignal({
        venueId: "venue-xjf3n0",
        signalKey: "music",
        signalValue: "loud",
      }),
    ).toEqual({ ok: false, error: "Pick what you noticed." });
  });

  it("cleans and caps the venue id without trusting client metadata", () => {
    const result = validateCommunityVenueSignal({
      venueId: `venue-\u0007abc${"x".repeat(200)}`,
      signalKey: "door-policy",
      signalValue: "trainers",
      submittedAt: 1,
      corroborations: 99,
      source: "editorial",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({
      venueId: expect.not.stringContaining("\u0007"),
      signalKey: "door-policy",
      signalValue: "trainers",
    });
    expect(result.value.venueId).toHaveLength(64);
  });
});

describe("communityVenueSignalText", () => {
  it("keeps entrance and toilet access visibly unknown with no reports", () => {
    expect(communityVenueSignalText("step-free-venue", undefined, NOW)).toEqual({
      primary: "Unknown",
      detail: "Nobody has confirmed step-free entrance access.",
      trust: "unknown",
    });
    expect(communityVenueSignalText("step-free-toilets", undefined, NOW)).toEqual({
      primary: "Unknown",
      detail: "Nobody has confirmed step-free toilet access.",
      trust: "unknown",
    });
  });

  it("does not turn one positive access report into a step-free claim", () => {
    expect(
      communityVenueSignalText(
        "step-free-venue",
        signal("step-free-venue", "step-free"),
        NOW,
      ),
    ).toEqual({
      primary: "Unknown",
      detail: "One drinker reported a step-free entrance.",
      trust: "unknown",
    });
  });

  it("does not turn one negative access report into no access", () => {
    expect(
      communityVenueSignalText(
        "step-free-toilets",
        signal("step-free-toilets", "steps"),
        NOW,
      ),
    ).toEqual({
      primary: "Unknown",
      detail: "One drinker reported steps to the toilets.",
      trust: "unknown",
    });
  });

  // Ageing weakens a report, so it may only ever move to the supporting line.
  // The stale branch used to run first and promote one expired report into an
  // affirmative "the entrance was step-free" the fresh version refused to make.
  it("keeps a stale lone access report unknown at every age", () => {
    for (const signalKey of ["step-free-venue", "step-free-toilets"] as const) {
      for (const signalValue of ["step-free", "steps"] as const) {
        const text = communityVenueSignalText(
          signalKey,
          signal(signalKey, signalValue, {
            submittedAt: NOW - COMMUNITY_PRICE_MAX_AGE_MS - 1,
          }),
          NOW,
        );
        expect(text.primary).toBe("Unknown");
        expect(text.trust).toBe("unknown");
        expect(text.detail).toContain("Needs a fresh check.");
      }
    }
    expect(
      communityVenueSignalText(
        "step-free-venue",
        signal("step-free-venue", "step-free", {
          submittedAt: NOW - COMMUNITY_PRICE_MAX_AGE_MS - 1,
        }),
        NOW,
      ).detail,
    ).toBe(
      "Older drinker reports said the entrance was step-free. Needs a fresh check.",
    );
  });

  it("keeps a stale corroborated access answer unknown too", () => {
    const stale = signal("step-free-toilets", "step-free", {
      corroborations: 3,
      submittedAt: NOW - COMMUNITY_PRICE_MAX_AGE_MS - 1,
      establishedCandidate: {
        signalValue: "step-free",
        submittedAt: NOW - COMMUNITY_PRICE_MAX_AGE_MS - 1,
        corroborations: 3,
      },
    });
    expect(communityVenueSignalText("step-free-toilets", stale, NOW)).toEqual({
      primary: "Unknown",
      detail:
        "Older drinker reports said the toilets were step-free. Needs a fresh check.",
      trust: "unknown",
    });
  });

  it("only confirms access when two independent drinkers back it", () => {
    expect(
      communityVenueSignalText(
        "step-free-venue",
        signal("step-free-venue", "step-free", { corroborations: 2 }),
        NOW,
      ),
    ).toEqual({
      primary: "Step-free",
      detail: "Confirmed by 2 drinkers.",
      trust: "established",
    });
  });

  it("uses the best-backed candidate instead of a lone fresh contradiction", () => {
    expect(
      communityVenueSignalText(
        "step-free-toilets",
        signal("step-free-toilets", "steps", {
          corroborations: 1,
          establishedCandidate: {
            signalValue: "step-free",
            submittedAt: NOW - 1_000,
            corroborations: 2,
          },
        }),
        NOW,
      ),
    ).toEqual({
      primary: "Step-free",
      detail: "Confirmed by 2 drinkers. One newer report disagrees.",
      trust: "established",
    });
  });

  it("makes rough or posh explicitly a judgement by drinkers", () => {
    expect(
      communityVenueSignalText(
        "character",
        signal("character", "rough"),
        NOW,
      ),
    ).toEqual({
      primary: "One drinker called it rough.",
      trust: "reported",
    });
    expect(
      communityVenueSignalText(
        "character",
        signal("character", "posh", { corroborations: 2 }),
        NOW,
      ),
    ).toEqual({
      primary: "Drinkers called it posh.",
      detail: "2 people agreed.",
      trust: "established",
    });
  });

  it("keeps door and eating reports attributed to drinkers", () => {
    expect(
      communityVenueSignalText(
        "door-policy",
        signal("door-policy", "trainers", { corroborations: 2 }),
        NOW,
      ).primary,
    ).toBe("Drinkers reported trainers can be refused.");
    expect(
      communityVenueSignalText(
        "people-eating",
        signal("people-eating", "eating"),
        NOW,
      ).primary,
    ).toBe("One drinker saw people eating.");
  });

  it("does not present an old corroborated report as established tonight", () => {
    const old = signal("door-policy", "groups", {
      corroborations: 3,
      submittedAt: NOW - COMMUNITY_PRICE_MAX_AGE_MS - 1,
      establishedCandidate: {
        signalValue: "groups",
        submittedAt: NOW - COMMUNITY_PRICE_MAX_AGE_MS - 1,
        corroborations: 3,
      },
    });
    expect(communityVenueSignalText("door-policy", old, NOW)).toEqual({
      primary: "Older drinker reports said big groups can be refused.",
      detail: "Needs a fresh check.",
      trust: "reported",
    });
  });

  it("names access as the questions that only corroboration can answer", () => {
    expect(isAccessSignalKey("step-free-venue")).toBe(true);
    expect(isAccessSignalKey("step-free-toilets")).toBe(true);
    for (const signalKey of ["character", "door-policy", "people-eating"] as const) {
      expect(isAccessSignalKey(signalKey)).toBe(false);
    }
  });
});
