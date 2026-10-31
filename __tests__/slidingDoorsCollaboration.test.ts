import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase", async (original) => ({
  ...await original<typeof import("@/lib/supabase")>(), isSupabaseConfigured: () => false,
}));

import { memoryPlanStore, __resetMemoryPlans } from "@/lib/planStore";
import { planCollaborationStore, __resetPlanCollaboration } from "@/lib/planCollaborationStore";
import { mintPlanGroundingProofV2, PLAN_GROUNDING_PROOF_TTL_MS } from "@/lib/planGrounding.server";

const stops = ["a", "b", "c"].map((id, position) => ({ venueId: `venue-${id}`, venueName: id.toUpperCase(), position }));
const alternative = [stops[0]!, stops[1]!, { venueId: "venue-d", venueName: "D", position: 2 }];

beforeEach(() => { __resetMemoryPlans(); __resetPlanCollaboration(); });

async function setup() {
  const created = await memoryPlanStore.create({
    startTime: new Date(Date.now() + 7_200_000).toISOString(), creatorName: "Host", stops,
  }, { anchor: { venueId: "venue-a", source: "near", outcome: "route" } });
  if (!created.ok) throw new Error("Plan setup failed");
  const joined = await memoryPlanStore.join(created.plan.plan.id, "Guest", { collaborationAuthorized: true });
  if (!joined.ok) throw new Error("Guest setup failed");
  return { id: created.plan.plan.id, host: created.memberToken, guest: joined.memberToken };
}

function input(now = Date.now(), next = alternative) {
  const operationKey = "sliding-doors-generation";
  return {
    reason: "A different last pub", expectedRouteRevision: 1, stops: next, resolvedConstraintIds: [],
    operationKey,
    groundingProof: mintPlanGroundingProofV2({ routeVenueIds: next.map((stop) => stop.venueId), anchorVenueId: "venue-a", anchorSource: "near", outcome: "route", operationKey }, now),
    idempotencyKey: "sliding-doors-proposal",
  };
}

describe("Sliding Doors uses the existing collaboration authority", () => {
  it("leaves the route unchanged during proposals and votes, then lets the host accept once", async () => {
    const { id, host, guest } = await setup();
    const store = planCollaborationStore();
    const proposal = await store.createProposal(id, guest, input());
    expect(proposal.ok).toBe(true);
    if (!proposal.ok) throw new Error("Proposal failed");
    expect(proposal.proposal).not.toHaveProperty("grounding");
    await store.vote(id, guest, proposal.proposal.id, "approve", "sliding-vote-one");
    expect((await memoryPlanStore.get(id))?.stops).toEqual(stops);
    const apply = async (value: typeof proposal.proposal) => (await memoryPlanStore.update(id, host, { stops: value.stops, expectedRouteRevision: value.expectedRouteRevision, groundedUpgrade: value.grounded })).ok;
    expect(await store.decideProposal(id, guest, proposal.proposal.id, "accepted", "guest-accept-denied", apply)).toMatchObject({ ok: false, error: "forbidden" });
    const results = await Promise.all([
      store.decideProposal(id, host, proposal.proposal.id, "accepted", "host-accept-once", apply),
      store.decideProposal(id, host, proposal.proposal.id, "accepted", "host-accept-once", apply),
    ]);
    expect(results.some((result) => result.ok)).toBe(true);
    expect((await memoryPlanStore.get(id))?.plan.routeRevision).toBe(2);
    expect((await memoryPlanStore.get(id))?.stops).toEqual(alternative);
    expect(await store.decideProposal(id, host, proposal.proposal.id, "accepted", "host-accept-once", apply, new Date(Date.now() + PLAN_GROUNDING_PROOF_TTL_MS * 2))).toMatchObject({ ok: true });
    expect((await memoryPlanStore.get(id))?.plan.routeRevision).toBe(2);
  });

  it("refuses missing, tampered and expired anchored checks", async () => {
    const { id, guest } = await setup();
    const store = planCollaborationStore();
    const valid = input();
    expect(await store.createProposal(id, guest, { ...valid, groundingProof: undefined })).toMatchObject({ ok: false, error: "forbidden" });
    expect(await store.createProposal(id, guest, { ...valid, groundingProof: `${valid.groundingProof}x` })).toMatchObject({ ok: false, error: "forbidden" });
    expect(await store.createProposal(id, guest, input(Date.now() - PLAN_GROUNDING_PROOF_TTL_MS - 1000))).toMatchObject({ ok: false, error: "expired" });
    expect((await memoryPlanStore.get(id))?.stops).toEqual(stops);
  });

  it("rejects a stale revision and a change to an actioned stop", async () => {
    const { id, host, guest } = await setup();
    const store = planCollaborationStore();
    expect(await store.createProposal(id, guest, { ...input(), expectedRouteRevision: 2 })).toMatchObject({ ok: false, error: "conflict" });
    await memoryPlanStore.addAction(id, host, { type: "arrived", stopPosition: 1, idempotencyKey: "arrived-second" });
    const reordered = [stops[0]!, { ...stops[2]!, position: 1 }, { ...stops[1]!, position: 2 }];
    expect(await store.createProposal(id, guest, input(Date.now(), reordered))).toMatchObject({ ok: false, error: "forbidden" });
  });

  it("rechecks current required needs and expiry when the host accepts", async () => {
    const { id, host, guest } = await setup();
    const store = planCollaborationStore();
    const proposal = await store.createProposal(id, guest, input());
    if (!proposal.ok) throw new Error("Proposal failed");
    const apply = vi.fn(async () => true);
    expect(await store.decideProposal(id, host, proposal.proposal.id, "accepted", "expired-decision", apply, new Date(Date.now() + PLAN_GROUNDING_PROOF_TTL_MS + 1000))).toMatchObject({ ok: false, error: "expired" });
    await store.addConstraint(id, guest, { kind: "accessibility", value: "Step-free entrance", priority: "required", idempotencyKey: "new-access-need" });
    await store.vote(id, guest, proposal.proposal.id, "approve", "approve-despite-need");
    expect(await store.decideProposal(id, host, proposal.proposal.id, "accepted", "needs-decision", apply)).toMatchObject({ ok: false, error: "constraints_unresolved" });
    expect(apply).not.toHaveBeenCalled();
  });

  it("rechecks the completed prefix when a member arrives after the proposal", async () => {
    const { id, host, guest } = await setup();
    const store = planCollaborationStore();
    const proposal = await store.createProposal(id, guest, input());
    if (!proposal.ok) throw new Error("Proposal failed");
    await memoryPlanStore.addAction(id, host, { type: "arrived", stopPosition: 2, idempotencyKey: "arrived-last" });
    const apply = vi.fn(async () => true);
    expect(await store.decideProposal(id, host, proposal.proposal.id, "accepted", "late-arrival-decision", apply)).toMatchObject({ ok: false, error: "forbidden" });
    expect(apply).not.toHaveBeenCalled();
  });
});
