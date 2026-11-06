import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// A plan made before the 2 October refresh can name a pub that has since left
// OpenStreetMap. Its invite keeps the stop's own name from the plan, but the
// route is drawn only through pubs still on the map.

const plan = vi.hoisted(() => ({ stops: [] as Array<{ venueId: string; venueName: string; position: number }> }));

vi.mock("@/lib/planStore", () => ({
  resolvePlanIdByInviteToken: async () => ({ ok: true, planId: "plan-1" }),
  planStateResult: async () => ({
    ok: true,
    plan: {
      plan: { title: "Brum crawl", startTime: "2026-10-03T19:00:00.000Z" },
      crew: [{ name: "host" }],
      context: null,
      stops: plan.stops,
    },
  }),
}));
vi.mock("@/lib/planInviteRsvpStore", () => ({
  rsvpStore: () => ({ summarize: async () => ({ counts: { going: 0, maybe: 0 }, guests: [] }) }),
  reactionStore: () => ({ summarize: async () => ({ counts: {}, mine: [] }) }),
}));
vi.mock("@/components/plan/PlanInviteRsvp", () => ({ default: () => null }));
vi.mock("@/components/plan/InvitePageView", () => ({ default: () => null }));

import PlanInvitePage from "@/app/invite/[token]/page";

const HARE_AND_HOUNDS = "venue-bhm-qvyo46";
const THE_KINGS_ARMS = "venue-bhm-14zsnx7";
const HENMAN_AND_COOPER = "venue-bhm-y7p3wr";

async function renderInvite(): Promise<string> {
  const element = await PlanInvitePage({ params: Promise.resolve({ token: "token-1" }) });
  return renderToStaticMarkup(createElement(() => element as React.ReactElement));
}

describe("an invite naming a pub that left the map", () => {
  it("names the stop but never routes through it", async () => {
    plan.stops = [
      { venueId: HARE_AND_HOUNDS, venueName: "Hare & Hounds", position: 0 },
      { venueId: HENMAN_AND_COOPER, venueName: "Henman & Cooper", position: 1 },
    ];
    const withRetired = await renderInvite();
    expect(withRetired).toContain("Henman &amp; Cooper");
    // One live point is no route: the retired stop contributes no coordinates.
    expect(withRetired).not.toContain("invite__thumbFrame");

    plan.stops = [
      { venueId: HARE_AND_HOUNDS, venueName: "Hare & Hounds", position: 0 },
      { venueId: THE_KINGS_ARMS, venueName: "The Kings Arms", position: 1 },
    ];
    expect(await renderInvite()).toContain("invite__thumbFrame");
  });
});
