// What /out carried onto /tonight when it became a redirect (16 Oct 2026): the
// open plans and the Drink Wall. Both ride the Out read Tonight already holds,
// and a plan section with nothing to show renders nothing, never an empty card.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import TonightOpenPlans, {
  TONIGHT_OPEN_PLAN_ASK_LABEL,
  TONIGHT_OPEN_PLANS_UNREAD_LINE,
  TonightDrinkWallLine,
} from "@/app/tonight/TonightOpenPlans";
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
    expect(html.match(/data-testid="tonight-open-plan"/g)).toHaveLength(1);
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

  it("each card shows the host's handle, the time, the meeting pub and Ask to join", () => {
    const html = render(body({ openPlans: [plan()] }));
    expect(html).toContain("@karan");
    expect(html).toMatch(/@karan · \w{3} 20:00/);
    expect(html).toContain("Meet at The Anchor");
    expect(html).toMatch(new RegExp(`href="/social/crews/crew-1"[^>]*>${TONIGHT_OPEN_PLAN_ASK_LABEL}`));
  });

  it("keeps the Drink Wall door as its own line", () => {
    const html = renderToStaticMarkup(createElement(TonightDrinkWallLine));
    expect(html).toContain('data-testid="tonight-drink-wall"');
    expect(html).toMatch(/href="\/wall"[^>]*>See the photos</);
  });
});
