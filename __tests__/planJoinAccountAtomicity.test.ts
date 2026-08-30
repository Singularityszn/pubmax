import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  userId: "11111111-1111-4111-8111-111111111111",
}));

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
import {
  __resetPlanCollaboration,
  planCollaborationStore,
} from "@/lib/planCollaborationStore";
import {
  __listMemoryPlanMemberUserIds,
  __resetMemoryPlans,
  memoryPlanStore,
  planInviteToken,
} from "@/lib/planStore";

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  auth.userId = "11111111-1111-4111-8111-111111111111";
  __resetMemoryPlans();
  __resetPlanCollaboration();
});

async function createPlan() {
  const created = await memoryPlanStore.create({
    title: "One account, one seat",
    creatorName: "Host",
    startTime: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
    stops: [
      { venueId: "venue-1f5ygjb", venueName: "The Crown" },
      { venueId: "venue-xjf3n0", venueName: "The Railway" },
      { venueId: "venue-3h52h", venueName: "The George" },
    ],
  }, { idempotencyKey: `account-join-host-${crypto.randomUUID()}` });
  if (!created.ok) throw new Error(created.error);
  return created;
}

async function join(planId: string, inviteToken: string, key: string, name: string) {
  return JOIN(new Request(`http://localhost/api/plans/${planId}/join`, {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": key },
    body: JSON.stringify({ name, inviteToken }),
  }), ctx(planId));
}

describe("signed-in Plan join account atomicity", () => {
  it("refuses a second classic-invite seat for the same account", async () => {
    const created = await createPlan();
    const invite = await planInviteToken(created.plan.plan.id);
    if (!invite.ok || !invite.inviteToken) throw new Error("missing invite");

    const first = await join(
      created.plan.plan.id,
      invite.inviteToken,
      "classic-account-join-one",
      "First name",
    );
    expect(first.status).toBe(200);

    const second = await join(
      created.plan.plan.id,
      invite.inviteToken,
      "classic-account-join-two",
      "Second name",
    );
    expect(second.status).toBe(409);
    expect(await second.json()).toMatchObject({ code: "PLAN_ACCOUNT_ALREADY_MEMBER" });
    expect((await memoryPlanStore.get(created.plan.plan.id))?.crew).toHaveLength(2);
    expect(__listMemoryPlanMemberUserIds(created.plan.plan.id)).toEqual([
      expect.objectContaining({ userId: auth.userId }),
    ]);
  });

  it("keeps a second collaboration invite unused when the account already joined", async () => {
    const created = await createPlan();
    const store = planCollaborationStore();
    const firstInvite = await store.createInvite(created.plan.plan.id, created.memberToken, {
      expiresInMinutes: 30,
      idempotencyKey: "account-collab-invite-one",
    });
    const secondInvite = await store.createInvite(created.plan.plan.id, created.memberToken, {
      expiresInMinutes: 30,
      idempotencyKey: "account-collab-invite-two",
    });
    if (!firstInvite.ok || !secondInvite.ok) throw new Error("missing collaboration invite");

    expect((await join(
      created.plan.plan.id,
      firstInvite.token,
      "account-collab-join-one",
      "First name",
    )).status).toBe(200);

    const second = await join(
      created.plan.plan.id,
      secondInvite.token,
      "account-collab-join-two",
      "Second name",
    );
    expect(second.status).toBe(409);
    expect(await second.json()).toMatchObject({ code: "PLAN_ACCOUNT_ALREADY_MEMBER" });
    expect((await memoryPlanStore.get(created.plan.plan.id))?.crew).toHaveLength(2);

    const state = await store.list(created.plan.plan.id, created.memberToken);
    if (!state.ok) throw new Error(state.error);
    expect(state.invites.find((invite) => invite.id === secondInvite.invite.id)?.redeemedAt).toBeNull();
  });

  it("does not replay one account's member capability to another account", async () => {
    const created = await createPlan();
    const invite = await planCollaborationStore().createInvite(
      created.plan.plan.id,
      created.memberToken,
      {
        expiresInMinutes: 30,
        idempotencyKey: "cross-account-invite",
      },
    );
    if (!invite.ok) throw new Error("missing collaboration invite");

    const first = await join(
      created.plan.plan.id,
      invite.token,
      "cross-account-join-key",
      "First account",
    );
    expect(first.status).toBe(200);
    const firstBody = await first.json() as { memberToken: string };

    auth.userId = "22222222-2222-4222-8222-222222222222";
    const second = await join(
      created.plan.plan.id,
      invite.token,
      "cross-account-join-key",
      "First account",
    );
    expect(second.status).toBe(409);
    expect(await second.json()).toMatchObject({ code: "PLAN_COLLAB_CONFLICT" });
    expect((await memoryPlanStore.get(created.plan.plan.id))?.crew).toHaveLength(2);
    expect(firstBody.memberToken).toBeTruthy();
  });
});
