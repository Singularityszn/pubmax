// What /out carried onto /tonight when it became a redirect (16 Oct 2026): the
// open plans and the Drink Wall. Both ride the Out read Tonight already holds,
// and a plan section with nothing to show renders nothing, never an empty card.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import TonightOpenPlans, { TONIGHT_OPEN_PLANS_UNREAD_LINE } from "@/app/tonight/TonightOpenPlans";
import type { OutOpenPlan } from "@/lib/out";
import type { OutResponse } from "@/lib/out/types";

function plan(overrides: Partial<OutOpenPlan> = {}): OutOpenPlan {
  return {
    crewId: "crew-1",
    title: "Soft plan",
    startTime: "2026-10-16T19:00:00.000Z",
    stopVenueId: "venue-1",
    stopVenueName: "The Anchor",
    hostHandle: "karan",
    memberCount: 2,
    meetingPoint: { kind: "venue", name: "The Anchor", lat: 51.5, lng: -0.1 },
    ...overrides,
  };
}

function body(overrides: Partial<OutResponse>): OutResponse {
  return {
    status: "ready",
    events: [],
    openPlans: [],
    openPlansStatus: "ready",
    attribution: [],
    observedAt: {},
    providers: [],
    ...overrides,
  } as OutResponse;
}

function render(input: OutResponse | null): string {
  return renderToStaticMarkup(createElement(TonightOpenPlans, { body: input }));
}

describe("Tonight's open plans and Drink Wall", () => {
  it("lists sendable plans with a way to start one", () => {
    const html = render(body({ openPlans: [plan(), plan({ crewId: "crew-2", meetingPoint: null })] }));
    expect(html).toContain('data-testid="tonight-open-plans"');
    expect(html).toContain("Soft plan");
    expect(html.match(/class="outOpenPlanCard"/g)).toHaveLength(1);
    expect(html).toContain("Start a plan");
  });

  it("renders no plan section while the read runs, in preview, or with nothing sendable", () => {
    for (const input of [
      null,
      body({ openPlansStatus: "preview", openPlans: [plan()] }),
      body({ openPlans: [plan({ meetingPoint: null })] }),
      body({ openPlans: [] }),
    ]) {
      const html = render(input);
      expect(html).not.toContain("Open plans");
      expect(html).not.toContain(TONIGHT_OPEN_PLANS_UNREAD_LINE);
    }
  });

  it("says a failed plans read in one line", () => {
    const html = render(body({ openPlansStatus: "degraded", openPlans: [plan()] }));
    expect(html).toContain(TONIGHT_OPEN_PLANS_UNREAD_LINE);
    expect(html).not.toContain('data-testid="tonight-open-plans"');
  });

  it("always keeps the Drink Wall door", () => {
    for (const input of [null, body({})]) {
      const html = render(input);
      expect(html).toContain('data-testid="tonight-drink-wall"');
      expect(html).toMatch(/href="\/wall"[^>]*>Browse the wall</);
    }
  });
});
