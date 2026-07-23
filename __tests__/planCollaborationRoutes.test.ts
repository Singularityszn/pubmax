import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return { ...actual, isSupabaseConfigured: () => false };
});
vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));
vi.mock("@/lib/pintDrops", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/pintDrops")>();
  return { ...actual, isLimited: async () => false };
});

import { POST as CREATE } from "@/app/api/plans/route";
import { POST as JOIN } from "@/app/api/plans/[id]/join/route";
import { POST as CREATE_INVITE } from "@/app/api/plans/[id]/invites/route";
import { POST as REDEEM_INVITE } from "@/app/api/plans/[id]/invites/redeem/route";
import { POST as ADD_CONSTRAINT } from "@/app/api/plans/[id]/constraints/route";
import { POST as CREATE_PROPOSAL } from "@/app/api/plans/[id]/proposals/route";
import { POST as DECIDE } from "@/app/api/plans/[id]/proposals/[proposalId]/decision/route";
import { POST as ACTION } from "@/app/api/plans/[id]/actions/route";
import { POST as COMPLETE } from "@/app/api/plans/[id]/complete/route";
import { __resetPlanCollaboration } from "@/lib/planCollaborationStore";
import { __resetMemoryPlans } from "@/lib/planStore";

const URL = "http://localhost/api/plans";
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const proposalCtx = (id: string, proposalId: string) => ({ params: Promise.resolve({ id, proposalId }) });
const route = [{ venueId: "venue-1f5ygjb" }, { venueId: "venue-xjf3n0" }, { venueId: "venue-3h52h" }];

beforeEach(() => { __resetMemoryPlans(); __resetPlanCollaboration(); });

async function createPlan() {
  const startTime = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
  const response = await CREATE(new Request(URL, { method: "POST", headers: { "idempotency-key": `collab-host-${crypto.randomUUID()}` }, body: JSON.stringify({ startTime, creatorName: "Host", stops: route }) }));
  return await response.json() as { plan: { plan: { id: string } }; memberToken: string; role: string };
}

let inviteSequence = 0;
async function joinInvited(host: Awaited<ReturnType<typeof createPlan>>, name = "Guest") {
  inviteSequence += 1;
  const inviteResponse = await CREATE_INVITE(new Request(`${URL}/${host.plan.plan.id}/invites`, {
    method: "POST", headers: { authorization: `Bearer ${host.memberToken}`, "idempotency-key": `invite-helper-${inviteSequence}` }, body: JSON.stringify({ expiresInMinutes: 30 }),
  }), ctx(host.plan.plan.id));
  const invite = await inviteResponse.json() as { token: string };
  return JOIN(new Request(`${URL}/${host.plan.plan.id}/join`, { method: "POST", headers: { "idempotency-key": `invited-join-${inviteSequence}` }, body: JSON.stringify({ name, inviteToken: invite.token }) }), ctx(host.plan.plan.id));
}

describe("Plan collaboration HTTP contract", () => {
  it("issues a host-only invite and rejects replay when it is joined twice", async () => {
    const host = await createPlan();
    expect(host.role).toBe("host");
    const inviteResponse = await CREATE_INVITE(new Request(`${URL}/${host.plan.plan.id}/invites`, {
      method: "POST", headers: { authorization: `Bearer ${host.memberToken}`, "idempotency-key": "invite-http-1" }, body: JSON.stringify({ expiresInMinutes: 30 }),
    }), ctx(host.plan.plan.id));
    expect(inviteResponse.status).toBe(201);
    const invite = await inviteResponse.json() as { token: string };

    const malformed = await JOIN(new Request(`${URL}/${host.plan.plan.id}/join`, { method: "POST", body: JSON.stringify({ name: "", inviteToken: invite.token }) }), ctx(host.plan.plan.id));
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toMatchObject({ code: "PLAN_JOIN_NAME_REQUIRED", retryable: false });
    const first = await JOIN(new Request(`${URL}/${host.plan.plan.id}/join`, { method: "POST", headers: { "idempotency-key": "invite-first-consume" }, body: JSON.stringify({ name: "Guest", inviteToken: invite.token }) }), ctx(host.plan.plan.id));
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ role: "guest" });
    const replay = await JOIN(new Request(`${URL}/${host.plan.plan.id}/join`, { method: "POST", headers: { "idempotency-key": "invite-second-consume" }, body: JSON.stringify({ name: "Other", inviteToken: invite.token }) }), ctx(host.plan.plan.id));
    expect(replay.status).toBe(409);
    expect(await replay.json()).toMatchObject({ code: "PLAN_COLLAB_REPLAYED", retryable: false });
  });

  it("recovers an invite join only when the same request key is retried", async () => {
    const host = await createPlan();
    const inviteResponse = await CREATE_INVITE(new Request(`${URL}/${host.plan.plan.id}/invites`, {
      method: "POST", headers: { authorization: `Bearer ${host.memberToken}`, "idempotency-key": "invite-recovery-create" }, body: JSON.stringify({ expiresInMinutes: 30 }),
    }), ctx(host.plan.plan.id));
    const invite = await inviteResponse.json() as { token: string };
    const request = (name: string, key: string) => JOIN(new Request(`${URL}/${host.plan.plan.id}/join`, {
      method: "POST", headers: { "idempotency-key": key }, body: JSON.stringify({ name, inviteToken: invite.token }),
    }), ctx(host.plan.plan.id));
    const first = await request("Guest", "invite-join-recovery");
    const firstBody = await first.json() as { memberToken: string };
    const replay = await request("Guest", "invite-join-recovery");
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ memberToken: firstBody.memberToken, collaborationAuthorized: true });
    expect((await request("Other", "invite-join-recovery")).status).toBe(409);
    expect((await request("Guest", "different-invite-join")).status).toBe(409);
  });

  it("keeps route acceptance host-only and blocks unresolved required constraints", async () => {
    const host = await createPlan();
    const joined = await joinInvited(host);
    const guest = await joined.json() as { memberToken: string };
    const constraintResponse = await ADD_CONSTRAINT(new Request(`${URL}/${host.plan.plan.id}/constraints`, { method: "POST", headers: { authorization: `Bearer ${guest.memberToken}`, "idempotency-key": "constraint-http-1" }, body: JSON.stringify({ kind: "accessibility", value: "Step-free required", priority: "required" }) }), ctx(host.plan.plan.id));
    expect(constraintResponse.status).toBe(201);
    const proposalResponse = await CREATE_PROPOSAL(new Request(`${URL}/${host.plan.plan.id}/proposals`, { method: "POST", headers: { authorization: `Bearer ${guest.memberToken}`, "idempotency-key": "proposal-http-1" }, body: JSON.stringify({ reason: "Swap route", expectedRouteRevision: 1, stops: route, resolvedConstraintIds: [] }) }), ctx(host.plan.plan.id));
    const proposal = await proposalResponse.json() as { proposal: { id: string } };

    const guestDecision = await DECIDE(new Request(`${URL}/${host.plan.plan.id}/proposals/${proposal.proposal.id}/decision`, { method: "POST", headers: { authorization: `Bearer ${guest.memberToken}`, "idempotency-key": "decision-guest-1" }, body: JSON.stringify({ decision: "accepted" }) }), proposalCtx(host.plan.plan.id, proposal.proposal.id));
    expect(guestDecision.status).toBe(403);
    const hostDecision = await DECIDE(new Request(`${URL}/${host.plan.plan.id}/proposals/${proposal.proposal.id}/decision`, { method: "POST", headers: { authorization: `Bearer ${host.memberToken}`, "idempotency-key": "decision-host-1" }, body: JSON.stringify({ decision: "accepted" }) }), proposalCtx(host.plan.plan.id, proposal.proposal.id));
    expect(hostDecision.status).toBe(409);
    expect(await hostDecision.json()).toMatchObject({ code: "PLAN_COLLAB_CONSTRAINTS_UNRESOLVED" });
  });

  it("keeps accepted swaps and ending completion host-only", async () => {
    const host = await createPlan();
    const joined = await joinInvited(host);
    const guest = await joined.json() as { memberToken: string };
    const swapped = await ACTION(new Request(`${URL}/${host.plan.plan.id}/actions`, { method: "POST", headers: { "idempotency-key": "guest-swap-denied" }, body: JSON.stringify({ memberToken: guest.memberToken, type: "swapped", stopPosition: 1 }) }), ctx(host.plan.plan.id));
    expect(swapped.status).toBe(403);
    const completed = await COMPLETE(new Request(`${URL}/${host.plan.plan.id}/complete`, { method: "POST", body: JSON.stringify({
      memberToken: guest.memberToken,
      expectedRouteRevision: 1,
      ending: "get_home",
      endingSelection: {
        kind: "get_home",
        optionId: "transport:nearest-station",
        evidenceSnapshot: { label: "Nearest station", confidence: "unknown" },
      },
    }) }), ctx(host.plan.plan.id));
    expect(completed.status).toBe(403);
  });

  it("keeps legacy public-link joins readable but denies collaboration mutations", async () => {
    const host = await createPlan();
    const joined = await JOIN(new Request(`${URL}/${host.plan.plan.id}/join`, { method: "POST", headers: { "idempotency-key": "legacy-guest-join" }, body: JSON.stringify({ name: "Legacy guest" }) }), ctx(host.plan.plan.id));
    const guest = await joined.json() as { memberToken: string; collaborationAuthorized: boolean };
    expect(guest.collaborationAuthorized).toBe(false);
    const constraint = await ADD_CONSTRAINT(new Request(`${URL}/${host.plan.plan.id}/constraints`, { method: "POST", headers: { authorization: `Bearer ${guest.memberToken}`, "idempotency-key": "legacy-constraint-1" }, body: JSON.stringify({ kind: "other", value: "Mutate", priority: "preference" }) }), ctx(host.plan.plan.id));
    expect(constraint.status).toBe(403);
    const arrived = await ACTION(new Request(`${URL}/${host.plan.plan.id}/actions`, { method: "POST", headers: { "idempotency-key": "legacy-arrived-denied" }, body: JSON.stringify({ memberToken: guest.memberToken, type: "arrived", stopPosition: 0 }) }), ctx(host.plan.plan.id));
    expect(arrived.status).toBe(403);
  });

  it("atomically upgrades an existing read-only member with a secure invite", async () => {
    const host = await createPlan();
    const legacyJoin = await JOIN(new Request(`${URL}/${host.plan.plan.id}/join`, { method: "POST", headers: { "idempotency-key": "upgrade-legacy-join" }, body: JSON.stringify({ name: "Existing guest" }) }), ctx(host.plan.plan.id));
    const legacy = await legacyJoin.json() as { memberToken: string };
    const inviteResponse = await CREATE_INVITE(new Request(`${URL}/${host.plan.plan.id}/invites`, { method: "POST", headers: { authorization: `Bearer ${host.memberToken}`, "idempotency-key": "upgrade-existing-1" }, body: JSON.stringify({ expiresInMinutes: 30 }) }), ctx(host.plan.plan.id));
    const invite = await inviteResponse.json() as { token: string };
    const upgraded = await REDEEM_INVITE(new Request(`${URL}/${host.plan.plan.id}/invites/redeem`, { method: "POST", headers: { authorization: `Bearer ${legacy.memberToken}` }, body: JSON.stringify({ inviteToken: invite.token }) }), ctx(host.plan.plan.id));
    expect(upgraded.status).toBe(200);
    expect(await upgraded.json()).toMatchObject({ collaborationAuthorized: true });
    const constraint = await ADD_CONSTRAINT(new Request(`${URL}/${host.plan.plan.id}/constraints`, { method: "POST", headers: { authorization: `Bearer ${legacy.memberToken}`, "idempotency-key": "upgraded-constraint-1" }, body: JSON.stringify({ kind: "other", value: "Now authorized", priority: "preference" }) }), ctx(host.plan.plan.id));
    expect(constraint.status).toBe(201);
  });
});
