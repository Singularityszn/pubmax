import { beforeEach, describe, expect, it, vi } from "vitest";

// Only the external Auth provider is a fixture. The join, membership, follow,
// notification and ownership paths use the real local stores and handlers.
const accounts = vi.hoisted(() => new Map([
  ["local-host", "11111111-1111-4111-8111-111111111111"],
  ["local-guest", "22222222-2222-4222-8222-222222222222"],
  ["local-stranger", "33333333-3333-4333-8333-333333333333"],
]));

vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return {
    ...actual,
    getSupabaseAdmin: () => ({
      auth: {
        getUser: async (token: string) => ({
          data: { user: accounts.has(token) ? { id: accounts.get(token) } : null },
          error: accounts.has(token) ? null : { status: 401 },
        }),
      },
    }),
  };
});

import { POST as JOIN } from "@/app/api/plans/[id]/join/route";
import { POST as FOLLOW } from "@/app/api/profiles/[handle]/follow/route";
import { GET as INBOX } from "@/app/api/notifications/route";
import { __resetMemoryFollows, memoryFollowStore } from "@/lib/followStore";
import { __resetMemoryNotifications } from "@/lib/notificationsStore";
import { __resetMemoryProfiles, memoryProfileStore } from "@/lib/profileStore";
import { __resetMemoryPlans, memoryPlanStore, planInviteToken, planMemberIdentity } from "@/lib/planStore";
import { claimPlanMembership } from "@/lib/planCrewIdentity";
import { __resetPlanCollaboration, planCollaborationStore } from "@/lib/planCollaborationStore";
import { clearSocialMemoryBlocks, setSocialMemoryBlock } from "@/lib/socialBlockMemory";
import type { NotificationDTO } from "@/lib/notifications";

beforeEach(async () => {
  __resetMemoryPlans();
  __resetPlanCollaboration();
  __resetMemoryFollows();
  __resetMemoryNotifications();
  __resetMemoryProfiles();
  clearSocialMemoryBlocks();
  for (const handle of ["host", "guest", "stranger"]) {
    await memoryProfileStore.createOwned(handle, accounts.get(`local-${handle}`)!);
  }
});

async function createPlan() {
  const created = await memoryPlanStore.create({
    title: "A local night together",
    creatorName: "Host",
    startTime: new Date(Date.now() + 7_200_000).toISOString(),
    stops: [{ venueId: "venue-1f5ygjb", venueName: "The Crown" }],
  }, { idempotencyKey: crypto.randomUUID() });
  if (!created.ok) throw new Error(created.error);
  const id = created.plan.plan.id;
  const identity = await planMemberIdentity(id, created.memberToken);
  expect(identity).not.toBeNull();
  expect(await claimPlanMembership(id, identity!.memberId, accounts.get("local-host")!)).toBe("claimed");
  const invite = await planInviteToken(id);
  if (!invite.ok || !invite.inviteToken) throw new Error("Missing local invite");
  return { id, inviteToken: invite.inviteToken, memberToken: created.memberToken };
}

function join(id: string, inviteToken: string, key: string = crypto.randomUUID()) {
  return JOIN(new Request(`http://localhost/api/plans/${id}/join`, {
    method: "POST",
    headers: { authorization: "Bearer local-guest", "idempotency-key": key },
    body: JSON.stringify({ name: "Guest", inviteToken }),
  }), { params: Promise.resolve({ id }) });
}

async function inbox(token: string | null, handle: string) {
  const response = await INBOX(new Request(`http://localhost/api/notifications?handle=${handle}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  }));
  return { status: response.status, body: await response.json() as { notifications: NotificationDTO[]; unread: number } };
}

function signal(actorHandle: string) {
  return { actorHandle, kind: "follow", subjectRef: actorHandle, read: false };
}

describe("plan-join Activity", () => {
  it("delivers the same recipient-only follow signal as an explicit follow", async () => {
    const followed = await FOLLOW(new Request("http://localhost/api/profiles/host/follow", {
      method: "POST",
      headers: { authorization: "Bearer local-guest" },
      body: JSON.stringify({}),
    }), { params: Promise.resolve({ handle: "host" }) });
    expect(followed.status).toBe(200);
    const explicit = await inbox("local-host", "host");
    expect(explicit.body.notifications).toEqual([expect.objectContaining(signal("guest"))]);

    __resetMemoryFollows();
    __resetMemoryNotifications();
    const plan = await createPlan();
    const joined = await join(plan.id, plan.inviteToken);
    expect(joined.status).toBe(200);
    expect(await joined.json()).toMatchObject({ friendEdgesFormed: 1 });
    expect(await memoryFollowStore.listMutuals("guest")).toEqual(["host"]);
    const hostInbox = await inbox("local-host", "host");
    const guestInbox = await inbox("local-guest", "guest");
    expect(hostInbox.body.notifications).toEqual([expect.objectContaining(signal("guest"))]);
    expect(guestInbox.body.notifications).toEqual([expect.objectContaining(signal("host"))]);
    expect(hostInbox.body.unread).toBe(1);
    expect(guestInbox.body.unread).toBe(1);
    // A query handle cannot substitute for the verified account's inbox.
    expect((await inbox("local-stranger", "host")).body).toEqual({ notifications: [], unread: 0 });
    expect((await inbox(null, "host")).status).toBe(403);
    expect((await inbox("invalid", "host")).status).toBe(403);
  });

  it("notifies each recipient once across concurrent and later classic retries", async () => {
    const plan = await createPlan();
    const key = crypto.randomUUID();
    const responses = await Promise.all([join(plan.id, plan.inviteToken, key), join(plan.id, plan.inviteToken, key)]);
    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    expect((await join(plan.id, plan.inviteToken, key)).status).toBe(200);
    expect((await join(plan.id, plan.inviteToken)).status).toBe(409);
    expect((await inbox("local-host", "host")).body.notifications).toHaveLength(1);
    expect((await inbox("local-guest", "guest")).body.notifications).toHaveLength(1);
  });

  it("delivers Activity for a collaboration join and does not duplicate its replay", async () => {
    const plan = await createPlan();
    const invite = await planCollaborationStore().createInvite(plan.id, plan.memberToken, {
      expiresInMinutes: 30, idempotencyKey: crypto.randomUUID(),
    });
    if (!invite.ok) throw new Error(invite.error);
    const key = crypto.randomUUID();
    expect((await join(plan.id, invite.token, key)).status).toBe(200);
    expect((await join(plan.id, invite.token, key)).status).toBe(200);
    expect((await inbox("local-host", "host")).body.notifications).toEqual([expect.objectContaining(signal("guest"))]);
    expect((await inbox("local-guest", "guest")).body.notifications).toEqual([expect.objectContaining(signal("host"))]);
  });

  it("notifies only the target of the missing direction when a one-way follow exists", async () => {
    await memoryFollowStore.follow("guest", "host");
    const plan = await createPlan();
    expect((await join(plan.id, plan.inviteToken)).status).toBe(200);
    expect((await inbox("local-host", "host")).body.notifications).toHaveLength(0);
    expect((await inbox("local-guest", "guest")).body.notifications).toEqual([expect.objectContaining(signal("host"))]);
  });

  it("does not invent Activity for an existing friendship", async () => {
    await memoryFollowStore.follow("guest", "host");
    await memoryFollowStore.follow("host", "guest");
    const plan = await createPlan();
    expect((await join(plan.id, plan.inviteToken)).status).toBe(200);
    expect((await inbox("local-host", "host")).body.notifications).toHaveLength(0);
    expect((await inbox("local-guest", "guest")).body.notifications).toHaveLength(0);
  });

  it("creates no follow Activity across a block", async () => {
    const host = await memoryProfileStore.getByHandle("host");
    const guest = await memoryProfileStore.getByHandle("guest");
    setSocialMemoryBlock(host!.id, guest!.id, true);
    const plan = await createPlan();
    expect((await join(plan.id, plan.inviteToken)).status).toBe(200);
    expect(await memoryFollowStore.listMutuals("host")).toEqual([]);
    expect((await inbox("local-host", "host")).body.notifications).toHaveLength(0);
    expect((await inbox("local-guest", "guest")).body.notifications).toHaveLength(0);
  });

  it("creates no Activity for missing or invalid invites", async () => {
    const plan = await createPlan();
    expect((await join(plan.id, "")).status).toBe(403);
    expect((await join(plan.id, "f".repeat(32))).status).toBe(403);
    expect(await memoryFollowStore.listMutuals("host")).toEqual([]);
    expect((await inbox("local-host", "host")).body.notifications).toHaveLength(0);
    expect((await inbox("local-guest", "guest")).body.notifications).toHaveLength(0);
  });

  it("creates no Activity when the join store fails", async () => {
    const plan = await createPlan();
    const failure = vi.spyOn(memoryPlanStore, "join").mockResolvedValueOnce({ ok: false, error: "error" });
    try {
      expect((await join(plan.id, plan.inviteToken)).status).toBe(503);
      expect(await memoryFollowStore.listMutuals("host")).toEqual([]);
      expect((await inbox("local-host", "host")).body.notifications).toHaveLength(0);
      expect((await inbox("local-guest", "guest")).body.notifications).toHaveLength(0);
    } finally {
      failure.mockRestore();
    }
  });
});
