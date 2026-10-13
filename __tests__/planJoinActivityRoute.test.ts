import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// External Auth and relationship RPCs are fixtures. The join, membership, follow,
// notification and ownership paths use the real local stores and handlers.
const accounts = vi.hoisted(() => new Map([
  ["local-host", "11111111-1111-4111-8111-111111111111"],
  ["local-guest", "22222222-2222-4222-8222-222222222222"],
  ["local-stranger", "33333333-3333-4333-8333-333333333333"],
  ["local-mate", "44444444-4444-4444-8444-444444444444"],
]));

const relationshipRpc = vi.hoisted(() => ({
  configured: false,
  query: vi.fn<(firstProfileId: string, secondProfileId: string) => Promise<unknown>>(),
}));

vi.mock("@/lib/crewFriendEdges", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/crewFriendEdges")>();
  return {
    ...actual,
    formFriendEdgesForPlanJoin: (
      input: Parameters<typeof actual.formFriendEdgesForPlanJoin>[0],
      dependencies: Parameters<typeof actual.formFriendEdgesForPlanJoin>[1],
    ) => actual.formFriendEdgesForPlanJoin(input, {
      supabaseConfigured: () => relationshipRpc.configured,
      relationship: relationshipRpc.query,
      ...dependencies,
    }),
  };
});

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
import { __resetMemoryProfileWithdrawals, __setMemoryProfileWithdrawn } from "@/lib/accountPublicAccess.server";
import type { NotificationDTO } from "@/lib/notifications";

beforeEach(async () => {
  relationshipRpc.configured = false;
  relationshipRpc.query.mockReset();
  __resetMemoryProfileWithdrawals();
  __resetMemoryPlans();
  __resetPlanCollaboration();
  __resetMemoryFollows();
  __resetMemoryNotifications();
  __resetMemoryProfiles();
  clearSocialMemoryBlocks();
  for (const handle of ["host", "guest", "stranger", "mate"]) {
    await memoryProfileStore.createOwned(handle, accounts.get(`local-${handle}`)!);
  }
});

afterEach(() => {
  __resetMemoryProfileWithdrawals();
});

async function createPlan(claimHost = true) {
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
  if (claimHost) {
    expect(await claimPlanMembership(id, identity!.memberId, accounts.get("local-host")!)).toBe("claimed");
  }
  const invite = await planInviteToken(id);
  if (!invite.ok || !invite.inviteToken) throw new Error("Missing local invite");
  return { id, inviteToken: invite.inviteToken, memberToken: created.memberToken };
}

function join(id: string, inviteToken: string, key: string = crypto.randomUUID(), token: string | null = "local-guest") {
  return JOIN(new Request(`http://localhost/api/plans/${id}/join`, {
    method: "POST",
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), "idempotency-key": key },
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
  describe.each(["classic", "collaboration"] as const)("%s joins with an unavailable relationship", (kind) => {
    describe.each(["error", "invalid response"] as const)("%s", (failure) => {
      it.each(["none", "host", "guest", "mutual"] as const)("preserves %s follows and creates no Activity across retries", async (existingFollower) => {
        const plan = await createPlan();
        let inviteToken = plan.inviteToken;
        if (kind === "collaboration") {
          const invite = await planCollaborationStore().createInvite(plan.id, plan.memberToken, {
            expiresInMinutes: 30, idempotencyKey: crypto.randomUUID(),
          });
          if (!invite.ok) throw new Error(invite.error);
          inviteToken = invite.token;
        }
        const hostFollowsGuest = existingFollower === "host" || existingFollower === "mutual";
        const guestFollowsHost = existingFollower === "guest" || existingFollower === "mutual";
        const host = await memoryProfileStore.getByHandle("host");
        const guest = await memoryProfileStore.getByHandle("guest");
        host!.id = crypto.randomUUID();
        guest!.id = crypto.randomUUID();
        if (hostFollowsGuest) await memoryFollowStore.follow("host", "guest");
        if (guestFollowsHost) await memoryFollowStore.follow("guest", "host");
        relationshipRpc.configured = true;
        if (failure === "error") {
          relationshipRpc.query.mockRejectedValue(new Error("Relationship RPC unavailable"));
        } else {
          relationshipRpc.query.mockResolvedValue(null);
        }

        const key = crypto.randomUUID();
        for (let attempt = 0; attempt < 2; attempt++) {
          const joined = await join(plan.id, inviteToken, key);
          expect(joined.status).toBe(200);
          expect(relationshipRpc.query).toHaveBeenCalledWith(guest!.id, host!.id);
          expect(await joined.json()).toMatchObject({ friendEdgesFormed: 0 });
          expect(await memoryFollowStore.isFollowing("host", "guest")).toBe(hostFollowsGuest);
          expect(await memoryFollowStore.isFollowing("guest", "host")).toBe(guestFollowsHost);
          for (const handle of ["host", "guest", "mate", "stranger"]) {
            expect((await inbox(`local-${handle}`, handle)).body).toEqual({ notifications: [], unread: 0 });
          }
        }
        expect(relationshipRpc.query.mock.calls).toEqual([
          [guest!.id, host!.id], [guest!.id, host!.id],
        ]);

        relationshipRpc.query.mockResolvedValue("blocked");
        const blockedRetry = await join(plan.id, inviteToken, key);
        expect(blockedRetry.status).toBe(200);
        expect(await blockedRetry.json()).toMatchObject({ friendEdgesFormed: 0 });
        expect(await memoryFollowStore.isFollowing("host", "guest")).toBe(hostFollowsGuest);
        expect(await memoryFollowStore.isFollowing("guest", "host")).toBe(guestFollowsHost);
        for (const handle of ["host", "guest"]) {
          expect((await inbox(`local-${handle}`, handle)).body).toEqual({ notifications: [], unread: 0 });
        }

        relationshipRpc.query.mockResolvedValue(existingFollower === "mutual" ? "mutual" : "not_mutual");
        const allowedRetry = await join(plan.id, inviteToken, key);
        expect(allowedRetry.status).toBe(200);
        expect(await allowedRetry.json()).toMatchObject({ friendEdgesFormed: existingFollower === "mutual" ? 0 : 1 });
        expect(await memoryFollowStore.listMutuals("guest")).toEqual(["host"]);
        expect((await join(plan.id, inviteToken, key)).status).toBe(200);
        expect((await inbox("local-host", "host")).body.notifications).toEqual(
          guestFollowsHost ? [] : [expect.objectContaining(signal("guest"))],
        );
        expect((await inbox("local-guest", "guest")).body.notifications).toEqual(
          hostFollowsGuest ? [] : [expect.objectContaining(signal("host"))],
        );
        for (const handle of ["mate", "stranger"]) {
          expect(await memoryFollowStore.listMutuals(handle)).toEqual([]);
          expect((await inbox(`local-${handle}`, handle)).body).toEqual({ notifications: [], unread: 0 });
        }
      });
    });
  });

  describe.each(["classic", "collaboration"] as const)("%s joins with a suspended participant", (kind) => {
    it.each([
      ["host", "none"],
      ["guest", "none"],
      ["host", "host"],
      ["guest", "host"],
      ["host", "guest"],
      ["guest", "guest"],
    ] as const)("creates no follow or Activity when %s is suspended and the existing follow is %s", async (withdrawnHandle, existingFollower) => {
      const plan = await createPlan();
      let inviteToken = plan.inviteToken;
      if (kind === "collaboration") {
        const invite = await planCollaborationStore().createInvite(plan.id, plan.memberToken, {
          expiresInMinutes: 30, idempotencyKey: crypto.randomUUID(),
        });
        if (!invite.ok) throw new Error(invite.error);
        inviteToken = invite.token;
      }
      if (existingFollower !== "none") {
        await memoryFollowStore.follow(existingFollower, existingFollower === "host" ? "guest" : "host");
      }
      const withdrawn = await memoryProfileStore.getByHandle(withdrawnHandle);
      __setMemoryProfileWithdrawn(withdrawn!.id, true);

      const key = crypto.randomUUID();
      for (let attempt = 0; attempt < 2; attempt++) {
        const joined = await join(plan.id, inviteToken, key);
        expect(joined.status).toBe(200);
        expect(await joined.json()).toMatchObject({ friendEdgesFormed: 0 });
        expect(await memoryFollowStore.isFollowing("host", "guest")).toBe(existingFollower === "host");
        expect(await memoryFollowStore.isFollowing("guest", "host")).toBe(existingFollower === "guest");
      }

      __setMemoryProfileWithdrawn(withdrawn!.id, false);
      for (const handle of ["host", "guest", "mate", "stranger"]) {
        const result = await inbox(`local-${handle}`, handle);
        expect(result.status).toBe(200);
        expect(result.body).toEqual({ notifications: [], unread: 0 });
      }
    });
  });

  it.each([null, "invalid"])("creates no friendship Activity without a verified joiner account (%s)", async (token) => {
    const plan = await createPlan();
    expect((await join(plan.id, plan.inviteToken, crypto.randomUUID(), token)).status).toBe(200);
    expect(await memoryFollowStore.listMutuals("host")).toEqual([]);
    expect((await inbox("local-host", "host")).body).toEqual({ notifications: [], unread: 0 });
    expect((await inbox("local-guest", "guest")).body).toEqual({ notifications: [], unread: 0 });
  });

  it.each(["classic", "collaboration"] as const)("connects a later %s joiner only with the host and leaves peer follows explicit", async (kind) => {
    const plan = await createPlan();
    expect((await join(plan.id, plan.inviteToken)).status).toBe(200);
    let inviteToken = plan.inviteToken;
    if (kind === "collaboration") {
      const invite = await planCollaborationStore().createInvite(plan.id, plan.memberToken, {
        expiresInMinutes: 30, idempotencyKey: crypto.randomUUID(),
      });
      if (!invite.ok) throw new Error(invite.error);
      inviteToken = invite.token;
    }
    const key = crypto.randomUUID();
    const joined = await join(plan.id, inviteToken, key, "local-mate");
    expect(joined.status).toBe(200);
    expect(await joined.json()).toMatchObject({ friendEdgesFormed: 1 });
    expect((await join(plan.id, inviteToken, key, "local-mate")).status).toBe(200);
    expect(await memoryFollowStore.listMutuals("mate")).toEqual(["host"]);
    expect(await memoryFollowStore.listMutuals("guest")).toEqual(["host"]);
    expect((await inbox("local-host", "host")).body.notifications).toEqual(expect.arrayContaining([
      expect.objectContaining(signal("guest")), expect.objectContaining(signal("mate")),
    ]));
    expect((await inbox("local-host", "host")).body.notifications).toHaveLength(2);
    expect((await inbox("local-guest", "guest")).body.notifications).toEqual([expect.objectContaining(signal("host"))]);
    expect((await inbox("local-mate", "mate")).body.notifications).toEqual([expect.objectContaining(signal("host"))]);
    expect((await inbox("local-stranger", "host")).body).toEqual({ notifications: [], unread: 0 });
    expect((await inbox("local-stranger", "mate")).body).toEqual({ notifications: [], unread: 0 });

    const followed = await FOLLOW(new Request("http://localhost/api/profiles/guest/follow", {
      method: "POST",
      headers: { authorization: "Bearer local-mate" },
      body: JSON.stringify({}),
    }), { params: Promise.resolve({ handle: "guest" }) });
    expect(followed.status).toBe(200);
    expect(await memoryFollowStore.isFollowing("mate", "guest")).toBe(true);
    expect(await memoryFollowStore.isFollowing("guest", "mate")).toBe(false);
    expect((await inbox("local-guest", "guest")).body.notifications).toEqual(expect.arrayContaining([
      expect.objectContaining(signal("host")), expect.objectContaining(signal("mate")),
    ]));
    expect((await inbox("local-guest", "guest")).body.notifications).toHaveLength(2);
    expect((await inbox("local-mate", "mate")).body.notifications).toEqual([expect.objectContaining(signal("host"))]);
  });

  it("does not substitute a claimed peer for an unclaimed host", async () => {
    const plan = await createPlan(false);
    expect((await join(plan.id, plan.inviteToken)).status).toBe(200);
    expect((await join(plan.id, plan.inviteToken, crypto.randomUUID(), "local-mate")).status).toBe(200);
    for (const handle of ["host", "guest", "mate"]) {
      expect(await memoryFollowStore.listMutuals(handle)).toEqual([]);
      expect((await inbox(`local-${handle}`, handle)).body).toEqual({ notifications: [], unread: 0 });
    }
  });

  it("does not substitute an unblocked peer when the host blocks a later joiner", async () => {
    const plan = await createPlan();
    expect((await join(plan.id, plan.inviteToken)).status).toBe(200);
    const host = await memoryProfileStore.getByHandle("host");
    const mate = await memoryProfileStore.getByHandle("mate");
    setSocialMemoryBlock(host!.id, mate!.id, true);
    const joined = await join(plan.id, plan.inviteToken, crypto.randomUUID(), "local-mate");
    expect(joined.status).toBe(200);
    expect(await joined.json()).toMatchObject({ friendEdgesFormed: 0 });
    expect(await memoryFollowStore.listMutuals("mate")).toEqual([]);
    expect(await memoryFollowStore.listMutuals("guest")).toEqual(["host"]);
    expect((await inbox("local-mate", "mate")).body).toEqual({ notifications: [], unread: 0 });
    expect((await inbox("local-host", "host")).body.notifications).toEqual([expect.objectContaining(signal("guest"))]);
    expect((await inbox("local-guest", "guest")).body.notifications).toEqual([expect.objectContaining(signal("host"))]);
  });

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
