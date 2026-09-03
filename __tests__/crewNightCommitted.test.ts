// The per-night metric counts NIGHTS. `crew_committed` therefore rides exactly
// one join per plan per night: the one that first takes the roster to two.
// Before issue #1253 every join carried the event, so a plan that reached four
// people reported three crew nights and the overcount grew with the crew.
import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ userId: null as string | null }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));
vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return { ...actual, isSupabaseConfigured: () => false };
});
vi.mock("@/lib/authServer", () => ({
  callerUserId: async () => auth.userId,
}));
vi.mock("@/lib/pintDrops", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/pintDrops")>();
  return { ...actual, isLimited: async () => false };
});

import { POST as JOIN } from "@/app/api/plans/[id]/join/route";
import { CREW_NIGHT_MIN_PARTICIPANTS, joinCommitsCrewNight } from "@/lib/crew";
import type { PlanState } from "@/lib/plan";
import { __resetPlanCollaboration } from "@/lib/planCollaborationStore";
import { planRouteReady } from "@/lib/planPrivacy";
import {
  __resetMemoryPlans,
  memoryPlanStore,
  planInviteToken,
} from "@/lib/planStore";
import { verifyAnalyticsDeliveryToken } from "@/lib/verifiedAnalytics.server";

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

/**
 * The receipt the ingest route dedupes on. Two mints a millisecond apart carry
 * different `issuedAt` bytes, so the token strings differ while the receipt
 * stays the same; comparing raw tokens would be a clock race.
 */
function receiptId(token: string | undefined): string {
  if (!token) throw new Error("no crew_committed token");
  const claims = JSON.parse(
    Buffer.from(token.split(".")[0]!, "base64url").toString("utf8"),
  ) as { eventId: string };
  return claims.eventId;
}

type JoinBody = {
  crewCommitted?: string;
  plan?: PlanState;
};

beforeEach(() => {
  auth.userId = null;
  __resetMemoryPlans();
  __resetPlanCollaboration();
});

async function createPlan(title: string) {
  const created = await memoryPlanStore.create({
    title,
    creatorName: "Host",
    startTime: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
    stops: [
      { venueId: "venue-1f5ygjb", venueName: "The Crown" },
      { venueId: "venue-xjf3n0", venueName: "The Railway" },
      { venueId: "venue-3h52h", venueName: "The George" },
    ],
  }, { idempotencyKey: `crew-night-${crypto.randomUUID()}` });
  if (!created.ok) throw new Error(created.error);
  const invite = await planInviteToken(created.plan.plan.id);
  if (!invite.ok || !invite.inviteToken) throw new Error("missing invite");
  return { planId: created.plan.plan.id, inviteToken: invite.inviteToken };
}

async function join(planId: string, inviteToken: string, name: string): Promise<JoinBody> {
  const response = await JOIN(new Request(`http://localhost/api/plans/${planId}/join`, {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": `${planId}:${name}` },
    body: JSON.stringify({ name, inviteToken }),
  }), ctx(planId));
  expect(response.status).toBe(200);
  return await response.json() as JoinBody;
}

describe("crew_committed counts nights, not joins", () => {
  it("hands the delivery token to one join out of three on one plan", async () => {
    const { planId, inviteToken } = await createPlan("Three guests, one night");

    const first = await join(planId, inviteToken, "Guest one");
    const second = await join(planId, inviteToken, "Guest two");
    const third = await join(planId, inviteToken, "Guest three");

    // The roster grows past the threshold, so the joins really are distinct.
    expect(first.plan?.crew).toHaveLength(2);
    expect(second.plan?.crew).toHaveLength(3);
    expect(third.plan?.crew).toHaveLength(4);

    const committed = [first, second, third].filter((body) => typeof body.crewCommitted === "string");
    expect(committed).toEqual([first]);
    expect(typeof first.crewCommitted).toBe("string");
  });

  it("reports the crossing roster size, so the participants >= 2 filter still holds", async () => {
    const { planId, inviteToken } = await createPlan("One crossing");

    const first = await join(planId, inviteToken, "Guest one");

    // The exact props the browser sends. A mismatch is refused at ingest, so
    // this also pins that the client and the mint agree on the crossing size.
    expect(verifyAnalyticsDeliveryToken(first.crewCommitted, {
      name: "crew_committed",
      props: {
        source: "shared-plan",
        participants: CREW_NIGHT_MIN_PARTICIPANTS,
        routeReady: first.plan ? planRouteReady(first.plan) : false,
      },
    })).toMatchObject({ name: "crew_committed" });
  });

  it("counts two plans as two nights", async () => {
    const one = await createPlan("Friday in Camden");
    const two = await createPlan("Friday in Soho");

    const joinedOne = await join(one.planId, one.inviteToken, "Guest one");
    const joinedTwo = await join(two.planId, two.inviteToken, "Guest one");

    // Distinct nights carry distinct receipts, so the ingest store cannot fold
    // one into the other.
    expect(receiptId(joinedOne.crewCommitted)).not.toBe(receiptId(joinedTwo.crewCommitted));
  });

  it("commits no night while the roster is below two", () => {
    expect(joinCommitsCrewNight(0)).toBe(false);
    expect(joinCommitsCrewNight(1)).toBe(false);
    expect(joinCommitsCrewNight(CREW_NIGHT_MIN_PARTICIPANTS)).toBe(true);
    expect(joinCommitsCrewNight(3)).toBe(false);
    expect(joinCommitsCrewNight(20)).toBe(false);
  });

  it("replays one join without a second night", async () => {
    const { planId, inviteToken } = await createPlan("Retried join");

    const first = await join(planId, inviteToken, "Guest one");
    const replay = await join(planId, inviteToken, "Guest one");

    // Same idempotency key, so the store replays the same seat. The subject is
    // the plan and its night, so the replay mints the same receipt and the
    // ingest store refuses it rather than recording a second night.
    expect(replay.plan?.crew).toHaveLength(2);
    expect(receiptId(replay.crewCommitted)).toBe(receiptId(first.crewCommitted));
  });
});
