import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import VenueCommunitySignals from "@/components/map/VenueCommunitySignals";
import { COMMUNITY_PRICE_MAX_AGE_MS } from "@/lib/communityPrice";
import type { CommunityVenueSignal } from "@/lib/communityVenueSignals";

const NOW = Date.parse("2026-07-28T20:00:00Z");

function render(
  signals: CommunityVenueSignal[] = [],
  readStatus: "idle" | "loading" | "ready" | "degraded" = "ready",
) {
  return renderToStaticMarkup(
    createElement(VenueCommunitySignals, {
      venueId: "venue-xjf3n0",
      venueName: "Arnos Arms",
      signals,
      readStatus,
      submitting: false,
      onSubmit: async () => ({ ok: true as const }),
      canSubmit: true,
      now: NOW,
    }),
  );
}

describe("VenueCommunitySignals", () => {
  it("keeps access visibly unknown in one compact disclosure", () => {
    const html = render();
    expect(html).toContain("<details");
    expect(html).toContain("What drinkers noticed");
    expect(html).toContain("Access unknown");
    expect((html.match(/class=\"venueCommunitySignals\"/g) ?? [])).toHaveLength(1);
  });

  it("distinguishes entrance access from toilet access", () => {
    const html = render();
    expect(html).toContain(">Entrance<");
    expect(html).toContain(">Toilets<");
    expect(html).toContain("Nobody has confirmed step-free entrance access.");
    expect(html).toContain("Nobody has confirmed step-free toilet access.");
  });

  it("offers all five decisions without five new cards", () => {
    const html = render();
    for (const label of ["Character", "Access", "Door", "Eating", "Alcohol-free"]) {
      expect(html).toContain(`>${label}<`);
    }
    expect(html).not.toContain("signalCard");
    expect(html).toContain("Neither character answer is a score.");
  });

  it("gives na-friendly the same reader row and typographic weight as the rest", () => {
    const html = render([
      {
        venueId: "venue-xjf3n0",
        signalKey: "na-friendly",
        signalValue: "good-na-options",
        submittedAt: NOW,
        source: "community",
        corroborations: 1,
      },
    ]);
    expect(html).toContain(">Alcohol-free<");
    expect(html).toContain("One drinker called the alcohol-free options good.");
    expect(html).not.toContain(">NA<");
  });

  it("attributes character to one drinker's judgement", () => {
    const html = render([
      {
        venueId: "venue-xjf3n0",
        signalKey: "character",
        signalValue: "rough",
        submittedAt: NOW,
        source: "community",
        corroborations: 1,
      },
    ]);
    expect(html).toContain("One drinker called it rough.");
    expect(html).not.toContain(">Rough pub<");
  });

  it("shows established wording only after corroboration", () => {
    const html = render([
      {
        venueId: "venue-xjf3n0",
        signalKey: "door-policy",
        signalValue: "trainers",
        submittedAt: NOW,
        source: "community",
        corroborations: 2,
        establishedCandidate: {
          signalValue: "trainers",
          submittedAt: NOW,
          corroborations: 2,
        },
      },
    ]);
    expect(html).toContain("Drinkers reported trainers can be refused.");
    expect(html).toContain("Confirmed by 2 drinkers.");
  });

  it("keeps the collapsed summary unknown when access reports have aged out", () => {
    const stale = NOW - COMMUNITY_PRICE_MAX_AGE_MS - 1;
    const html = render([
      {
        venueId: "venue-xjf3n0",
        signalKey: "step-free-venue",
        signalValue: "step-free",
        submittedAt: stale,
        source: "community",
        corroborations: 1,
      },
      {
        venueId: "venue-xjf3n0",
        signalKey: "step-free-toilets",
        signalValue: "step-free",
        submittedAt: stale,
        source: "community",
        corroborations: 1,
      },
    ]);
    expect(html).toContain("Access unknown");
    expect(html).not.toContain("Access reported");
    expect(html).not.toContain("Entrance unknown");
    expect(html).toContain("Needs a fresh check.");
  });

  it("does not flatten a failed read into unknown access", () => {
    const failed = render([], "degraded");
    expect(failed).toContain("Access unread");
    expect(failed).not.toContain("Access unknown");

    const pending = render([], "loading");
    expect(pending).toContain("Checking access");
    expect(pending).not.toContain("Access unknown");
  });

  it("labels every phone control and keeps access report targets separate", () => {
    const html = render();
    expect(html).toContain('aria-label="What did you notice?"');
    expect(html).toContain('aria-label="Which access did you check?"');
    expect(html).toContain('value="step-free-venue"');
    expect(html).toContain('value="step-free-toilets"');
    expect(html).toContain('type="submit"');
  });

  it("keeps readings public while withholding the signed-out composer", () => {
    const html = renderToStaticMarkup(
      createElement(VenueCommunitySignals, {
        venueId: "venue-xjf3n0",
        venueName: "Arnos Arms",
        signals: [],
        readStatus: "ready",
        submitting: false,
        onSubmit: async () => ({ ok: true as const }),
        canSubmit: false,
        now: NOW,
      }),
    );

    expect(html).toContain("What drinkers noticed");
    expect(html).toContain("Nobody has confirmed step-free entrance access.");
    expect(html).toContain("Sign in to add what you noticed.");
    expect(html).not.toContain("Add what you noticed");
    expect(html).not.toContain('type="submit"');
  });
});
