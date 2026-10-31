// ONE GUEST CAPABILITY (launch review 2026-10-30, section 3 item 5).
//
// "My mates on WhatsApp can't vote." The host's classic invite link used to
// seat a guest who could not vote, propose, add a need or check in, while only
// a one-use private invite could. The classic link IS the capability the host
// chose to share, so a guest seated through it (a join on /plan/[id] with the
// #invite= hash, or a Going RSVP on /invite/[token]) now collaborates. The
// host alone keeps: saving route changes, deciding proposals, rotating the
// link, removing RSVPs and completing the night. A bare plan id still joins
// nobody, and a rotated link still lets nobody new in.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return { ...actual, isSupabaseConfigured: () => false };
});
vi.mock("@/lib/storeBackend", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/storeBackend")>();
  return { ...actual, isSupabaseConfigured: () => false };
});
vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));
vi.mock("@/lib/opsFreeze", () => ({ socialFreezeResponse: () => null }));
vi.mock("@/lib/pintDrops", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/pintDrops")>();
  return { ...actual, isLimited: async () => false };
});

import { POST as CREATE } from "@/app/api/plans/route";
import { GET, PATCH } from "@/app/api/plans/[id]/route";
import { POST as JOIN } from "@/app/api/plans/[id]/join/route";
import { POST as ACTION } from "@/app/api/plans/[id]/actions/route";
import { POST as ADD_CONSTRAINT } from "@/app/api/plans/[id]/constraints/route";
import { POST as CREATE_PROPOSAL } from "@/app/api/plans/[id]/proposals/route";
import { POST as DECIDE } from "@/app/api/plans/[id]/proposals/[proposalId]/decision/route";
import { POST as VOTE } from "@/app/api/plans/[id]/proposals/[proposalId]/votes/route";
import { POST as REDEEM } from "@/app/api/plans/[id]/invites/redeem/route";
import { POST as ROTATE } from "@/app/api/plans/[id]/invite-rotate/route";
import { DELETE as REMOVE_RSVP } from "@/app/api/plans/[id]/invite-rsvp/route";
import { POST as PUBLIC_RSVP } from "@/app/api/invite/[token]/rsvp/route";
import { __resetPlanCollaboration } from "@/lib/planCollaborationStore";
import { __resetMemoryRsvps } from "@/lib/planInviteRsvpStore";
import { __resetMemoryPlans, memoryPlanStore, planMemberIdentity } from "@/lib/planStore";

const URL = "http://localhost/api/plans";
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const proposalCtx = (id: string, proposalId: string) => ({ params: Promise.resolve({ id, proposalId }) });
const tokenCtx = (token: string) => ({ params: Promise.resolve({ token }) });
const route = [{ venueId: "venue-1f5ygjb" }, { venueId: "venue-xjf3n0" }, { venueId: "venue-3h52h" }];

beforeEach(() => {
  __resetMemoryPlans();
  __resetPlanCollaboration();
  __resetMemoryRsvps();
});

async function hostWithClassicLink() {
  const startTime = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
  const created = await CREATE(new Request(URL, {
    method: "POST",
    headers: { "idempotency-key": `one-capability-host-${crypto.randomUUID()}` },
    body: JSON.stringify({ startTime, creatorName: "Host", stops: route }),
  }));
  const host = await created.json() as { plan: { plan: { id: string } }; memberToken: string };
  const planId = host.plan.plan.id;
  const projection = await GET(new Request(`${URL}/${planId}`, {
    headers: { authorization: `Bearer ${host.memberToken}` },
  }), ctx(planId));
  const { inviteToken } = await projection.json() as { inviteToken: string };
  expect(inviteToken).toMatch(/^[0-9a-f]{32}$/);
  return { planId, hostToken: host.memberToken, inviteToken };
}

async function classicJoin(planId: string, inviteToken: string | undefined, name = "Priya") {
  return JOIN(new Request(`${URL}/${planId}/join`, {
    method: "POST",
    headers: { "idempotency-key": `one-capability-join-${crypto.randomUUID()}` },
    body: JSON.stringify({ name, ...(inviteToken === undefined ? {} : { inviteToken }) }),
  }), ctx(planId));
}

async function guestProposal(planId: string, guestToken: string) {
  const response = await CREATE_PROPOSAL(new Request(`${URL}/${planId}/proposals`, {
    method: "POST",
    headers: { authorization: `Bearer ${guestToken}`, "idempotency-key": `one-capability-proposal-${crypto.randomUUID()}` },
    body: JSON.stringify({ reason: "Swap the order", expectedRouteRevision: 1, stops: route, resolvedConstraintIds: [] }),
  }), ctx(planId));
  expect(response.status).toBe(201);
  return (await response.json() as { proposal: { id: string } }).proposal.id;
}

describe("one guest capability through the host's classic link", () => {
  it("lets a guest who joined through the classic link vote, propose, add a need and check in", async () => {
    const { planId, inviteToken } = await hostWithClassicLink();
    const joined = await classicJoin(planId, inviteToken);
    expect(joined.status).toBe(200);
    const guest = await joined.json() as { memberToken: string; role: string; collaborationAuthorized: boolean };
    expect(guest).toMatchObject({ role: "guest", collaborationAuthorized: true });

    const need = await ADD_CONSTRAINT(new Request(`${URL}/${planId}/constraints`, {
      method: "POST",
      headers: { authorization: `Bearer ${guest.memberToken}`, "idempotency-key": "one-capability-need" },
      body: JSON.stringify({ kind: "accessibility", value: "Step-free please", priority: "preference" }),
    }), ctx(planId));
    expect(need.status).toBe(201);

    const proposalId = await guestProposal(planId, guest.memberToken);
    const vote = await VOTE(new Request(`${URL}/${planId}/proposals/${proposalId}/votes`, {
      method: "POST",
      headers: { authorization: `Bearer ${guest.memberToken}`, "idempotency-key": "one-capability-vote" },
      body: JSON.stringify({ value: "approve" }),
    }), proposalCtx(planId, proposalId));
    expect(vote.status).toBeLessThan(300);

    const checkIn = await ACTION(new Request(`${URL}/${planId}/actions`, {
      method: "POST",
      headers: { "idempotency-key": "one-capability-arrived" },
      body: JSON.stringify({ memberToken: guest.memberToken, type: "arrived", stopPosition: 0 }),
    }), ctx(planId));
    expect(checkIn.status).toBe(201);
  });

  it("keeps saving the route, deciding proposals, rotating the link and removing RSVPs with the host", async () => {
    const { planId, inviteToken } = await hostWithClassicLink();
    const guest = await (await classicJoin(planId, inviteToken)).json() as { memberToken: string };
    const auth = { authorization: `Bearer ${guest.memberToken}` };

    const swap = await ACTION(new Request(`${URL}/${planId}/actions`, {
      method: "POST",
      headers: { "idempotency-key": "one-capability-swap" },
      body: JSON.stringify({ memberToken: guest.memberToken, type: "swapped", stopPosition: 1 }),
    }), ctx(planId));
    expect(swap.status).toBe(403);

    const save = await PATCH(new Request(`${URL}/${planId}`, {
      method: "PATCH",
      headers: auth,
      body: JSON.stringify({ status: "ready" }),
    }), ctx(planId));
    expect(save.status).toBe(403);

    const proposalId = await guestProposal(planId, guest.memberToken);
    const decision = await DECIDE(new Request(`${URL}/${planId}/proposals/${proposalId}/decision`, {
      method: "POST",
      headers: { ...auth, "idempotency-key": "one-capability-decision" },
      body: JSON.stringify({ decision: "accepted" }),
    }), proposalCtx(planId, proposalId));
    expect(decision.status).toBe(403);

    const rotate = await ROTATE(new Request(`${URL}/${planId}/invite-rotate`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({}),
    }), ctx(planId));
    expect(rotate.status).toBe(403);
    expect(await rotate.json()).toMatchObject({ code: "PLAN_INVITE_ROTATE_FORBIDDEN" });

    const removal = await REMOVE_RSVP(new Request(`${URL}/${planId}/invite-rsvp`, {
      method: "DELETE",
      headers: auth,
      body: JSON.stringify({ rsvpId: "00000000-0000-4000-8000-000000000000" }),
    }), ctx(planId));
    expect(removal.status).toBe(403);
    expect(await removal.json()).toMatchObject({ code: "PLAN_INVITE_RSVP_FORBIDDEN" });
  });

  it("still refuses a bare plan id with PLAN_INVITE_REQUIRED", async () => {
    const { planId } = await hostWithClassicLink();
    const bare = await classicJoin(planId, undefined);
    expect(bare.status).toBe(403);
    expect(await bare.json()).toMatchObject({ code: "PLAN_INVITE_REQUIRED" });
  });

  it("shuts the old link after a rotate, for joins, RSVPs and seat lifts alike", async () => {
    const { planId, hostToken, inviteToken } = await hostWithClassicLink();
    const before = await (await classicJoin(planId, inviteToken, "Early")).json() as { memberToken: string };
    const rotated = await ROTATE(new Request(`${URL}/${planId}/invite-rotate`, {
      method: "POST",
      headers: { authorization: `Bearer ${hostToken}` },
      body: JSON.stringify({}),
    }), ctx(planId));
    expect(rotated.status).toBe(200);
    const { inviteToken: fresh } = await rotated.json() as { inviteToken: string };
    expect(fresh).not.toBe(inviteToken);

    const late = await classicJoin(planId, inviteToken, "Late");
    expect(late.status).toBe(403);
    expect(await late.json()).toMatchObject({ code: "PLAN_INVITE_INVALID" });

    const lateRsvp = await PUBLIC_RSVP(new Request(`http://localhost/api/invite/${inviteToken}/rsvp`, {
      method: "POST",
      body: JSON.stringify({ displayName: "Late", status: "going", submitterId: "late-device" }),
    }), tokenCtx(inviteToken));
    expect(lateRsvp.status).toBe(404);

    // The guest seated before the rotate keeps the seat they already had,
    // exactly as before: a rotate stops new people, it removes nobody.
    expect(await planMemberIdentity(planId, before.memberToken)).toMatchObject({ role: "guest", collaborationAuthorized: true });

    const legacy = await memoryPlanStore.join(planId, "Legacy", { collaborationAuthorized: false, idempotencyKey: "one-capability-legacy" });
    expect(legacy.ok).toBe(true);
    if (!legacy.ok) return;
    const staleLift = await REDEEM(new Request(`${URL}/${planId}/invites/redeem`, {
      method: "POST",
      headers: { authorization: `Bearer ${legacy.memberToken}` },
      body: JSON.stringify({ inviteToken }),
    }), ctx(planId));
    expect(staleLift.status).toBe(403);
    expect(await planMemberIdentity(planId, legacy.memberToken)).toMatchObject({ collaborationAuthorized: false });
  });

  it("lifts a guest seated read-only before this rule when they re-open the current link", async () => {
    const { planId, inviteToken } = await hostWithClassicLink();
    const legacy = await memoryPlanStore.join(planId, "Legacy", { collaborationAuthorized: false, idempotencyKey: "one-capability-lift" });
    expect(legacy.ok).toBe(true);
    if (!legacy.ok) return;
    const lift = await REDEEM(new Request(`${URL}/${planId}/invites/redeem`, {
      method: "POST",
      headers: { authorization: `Bearer ${legacy.memberToken}` },
      body: JSON.stringify({ inviteToken }),
    }), ctx(planId));
    expect(lift.status).toBe(200);
    expect(await lift.json()).toEqual({ ok: true, collaborationAuthorized: true, inviteId: null });
    expect(await planMemberIdentity(planId, legacy.memberToken)).toMatchObject({ collaborationAuthorized: true });

    const stranger = await REDEEM(new Request(`${URL}/${planId}/invites/redeem`, {
      method: "POST",
      headers: { authorization: `Bearer ${"f".repeat(64)}` },
      body: JSON.stringify({ inviteToken }),
    }), ctx(planId));
    expect(stranger.status).toBe(403);
  });

  it("seats a Going RSVP on the invite page with the same capability, and sets the member cookie", async () => {
    const { planId, inviteToken } = await hostWithClassicLink();
    const rsvp = await PUBLIC_RSVP(new Request(`http://localhost/api/invite/${inviteToken}/rsvp`, {
      method: "POST",
      body: JSON.stringify({ displayName: "Sam", status: "going", submitterId: "sam-device" }),
    }), tokenCtx(inviteToken));
    expect(rsvp.status).toBe(200);
    expect(rsvp.headers.get("set-cookie")).toContain(`Path=/api/plans/${planId}`);
    const body = await rsvp.json() as {
      memberToken: string;
      collaborationAuthorized: boolean;
      crewCommitted?: { deliveryToken: string; participants: number; routeReady: boolean };
    };
    expect(body.collaborationAuthorized).toBe(true);
    // Host plus Sam is the crew-night threshold, so this seat carries the receipt.
    expect(body.crewCommitted).toMatchObject({ participants: 2 });
    expect(body.crewCommitted?.deliveryToken).toEqual(expect.any(String));

    const proposalId = await guestProposal(planId, body.memberToken);
    const vote = await VOTE(new Request(`${URL}/${planId}/proposals/${proposalId}/votes`, {
      method: "POST",
      headers: { authorization: `Bearer ${body.memberToken}`, "idempotency-key": "one-capability-rsvp-vote" },
      body: JSON.stringify({ value: "approve" }),
    }), proposalCtx(planId, proposalId));
    expect(vote.status).toBeLessThan(300);

    const later = await PUBLIC_RSVP(new Request(`http://localhost/api/invite/${inviteToken}/rsvp`, {
      method: "POST",
      body: JSON.stringify({ displayName: "Jo", status: "going", submitterId: "jo-device" }),
    }), tokenCtx(inviteToken));
    expect((await later.json() as { crewCommitted?: unknown }).crewCommitted).toBeUndefined();
  });
});
