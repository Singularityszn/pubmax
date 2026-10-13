// WP7: plan joins form mutual follow edges only with the host.
// Blocks are never downgraded; unclaimed handles never get edges; re-join is
// idempotent.

import { beforeEach, describe, expect, it } from "vitest";

import {
  ensureMutualFollowPair,
  formFriendEdgesForPlanJoin,
} from "@/lib/crewFriendEdges";
import {
  memoryFollowStore,
  __resetMemoryFollows,
} from "@/lib/followStore";
import {
  memoryProfileStore,
  __resetMemoryProfiles,
} from "@/lib/profileStore";
import { __resetMemoryPlans, memoryPlanStore, planMemberIdentity } from "@/lib/planStore";
import { claimPlanMembership } from "@/lib/planCrewIdentity";
import {
  clearSocialMemoryBlocks,
  setSocialMemoryBlock,
} from "@/lib/socialBlockMemory";

beforeEach(() => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  __resetMemoryPlans();
  __resetMemoryFollows();
  __resetMemoryProfiles();
  clearSocialMemoryBlocks();
});

async function claimed(handle: string, userId: string) {
  return memoryProfileStore.createOwned(handle, userId);
}

describe("ensureMutualFollowPair", () => {
  it("creates both directions between claimed handles", async () => {
    await claimed("host", "user-host");
    await claimed("guest", "user-guest");

    const outcome = await ensureMutualFollowPair("host", "guest", {
      profiles: memoryProfileStore,
      follows: memoryFollowStore,
      supabaseConfigured: () => false,
      memoryBlocked: () => false,
    });

    expect(outcome).toBe("created");
    expect(await memoryFollowStore.isFollowing("host", "guest")).toBe(true);
    expect(await memoryFollowStore.isFollowing("guest", "host")).toBe(true);
  });

  it("is idempotent when the mutual pair already exists", async () => {
    await claimed("host", "user-host");
    await claimed("guest", "user-guest");
    await memoryFollowStore.follow("host", "guest");
    await memoryFollowStore.follow("guest", "host");

    const outcome = await ensureMutualFollowPair("host", "guest", {
      profiles: memoryProfileStore,
      follows: memoryFollowStore,
      supabaseConfigured: () => false,
      memoryBlocked: () => false,
    });

    expect(outcome).toBe("already");
    expect(await memoryFollowStore.counts("host")).toEqual({
      followers: 1,
      following: 1,
    });
  });

  it("never creates edges across a memory block", async () => {
    const host = await claimed("host", "user-host");
    const guest = await claimed("guest", "user-guest");
    setSocialMemoryBlock(host.id, guest.id, true);

    const outcome = await ensureMutualFollowPair("host", "guest", {
      profiles: memoryProfileStore,
      follows: memoryFollowStore,
      supabaseConfigured: () => false,
      // Use the real memory block map.
    });

    expect(outcome).toBe("blocked");
    expect(await memoryFollowStore.isFollowing("host", "guest")).toBe(false);
    expect(await memoryFollowStore.isFollowing("guest", "host")).toBe(false);
  });

  it("skips unclaimed handles", async () => {
    await claimed("host", "user-host");
    await memoryProfileStore.ensure("ghost");

    const outcome = await ensureMutualFollowPair("host", "ghost", {
      profiles: memoryProfileStore,
      follows: memoryFollowStore,
      supabaseConfigured: () => false,
      memoryBlocked: () => false,
    });

    expect(outcome).toBe("unclaimed");
    expect(await memoryFollowStore.isFollowing("host", "ghost")).toBe(false);
  });
});

async function planJoin(userId: string, claimHost = true) {
  const created = await memoryPlanStore.create({
    title: "A night together",
    creatorName: "Host",
    startTime: new Date(Date.now() + 7_200_000).toISOString(),
    stops: [{ venueId: "venue-1f5ygjb", venueName: "The Crown" }],
  }, { idempotencyKey: crypto.randomUUID() });
  if (!created.ok) throw new Error(created.error);
  const planId = created.plan.plan.id;
  const host = await planMemberIdentity(planId, created.memberToken);
  if (claimHost) {
    expect(await claimPlanMembership(planId, host!.memberId, "user-host")).toBe("claimed");
  }
  const peer = await memoryPlanStore.join(planId, "Mate", {
    idempotencyKey: crypto.randomUUID(), userId: "user-mate",
  });
  if (!peer.ok) throw new Error(peer.error);
  const joined = await memoryPlanStore.join(planId, "Guest", {
    idempotencyKey: crypto.randomUUID(), userId,
  });
  if (!joined.ok) throw new Error(joined.error);
  const identity = await planMemberIdentity(planId, joined.memberToken);
  return { planId, joinerUserId: userId, joinerMemberId: identity!.memberId };
}

describe("formFriendEdgesForPlanJoin", () => {
  it("forms mutuals only with the claimed host, leaving a claimed peer unchanged", async () => {
    await claimed("host", "user-host");
    await claimed("mate", "user-mate");
    await claimed("guest", "user-guest");

    const result = await formFriendEdgesForPlanJoin(await planJoin("user-guest"));

    expect(result.formed).toBe(1);
    expect(await memoryFollowStore.listMutuals("guest")).toEqual(["host"]);
    expect(await memoryFollowStore.listMutuals("host")).toEqual(["guest"]);
    expect(await memoryFollowStore.listMutuals("mate")).toEqual([]);
  });

  it("respects a host block without creating an edge to an unblocked peer", async () => {
    const host = await claimed("host", "user-host");
    await claimed("mate", "user-mate");
    const guest = await claimed("guest", "user-guest");
    setSocialMemoryBlock(host.id, guest.id, true);

    const result = await formFriendEdgesForPlanJoin(await planJoin("user-guest"));

    expect(result.skippedBlocked).toBe(1);
    expect(result.formed).toBe(0);
    expect(await memoryFollowStore.listMutuals("guest")).toEqual([]);
    expect(await memoryFollowStore.listMutuals("mate")).toEqual([]);
    expect(await memoryFollowStore.listMutuals("host")).toEqual([]);
  });

  it("second join reports already without adding peer friendships", async () => {
    await claimed("host", "user-host");
    await claimed("mate", "user-mate");
    await claimed("guest", "user-guest");
    const input = await planJoin("user-guest");

    expect((await formFriendEdgesForPlanJoin(input)).formed).toBe(1);
    const second = await formFriendEdgesForPlanJoin(input);

    expect(second.formed).toBe(0);
    expect(second.outcomes).toEqual(["already"]);
    expect(await memoryFollowStore.counts("guest")).toEqual({ followers: 1, following: 1 });
    expect(await memoryFollowStore.listMutuals("mate")).toEqual([]);
  });

  it("skips when the joiner has no claimed handle", async () => {
    await claimed("host", "user-host");
    const result = await formFriendEdgesForPlanJoin(await planJoin("user-nobody"));

    expect(result.skippedUnclaimed).toBe(1);
    expect(result.formed).toBe(0);
  });

  it("never treats the first claimed peer as an unclaimed host", async () => {
    await claimed("mate", "user-mate");
    await claimed("guest", "user-guest");
    const result = await formFriendEdgesForPlanJoin(await planJoin("user-guest", false));

    expect(result.formed).toBe(0);
    expect(await memoryFollowStore.listMutuals("guest")).toEqual([]);
    expect(await memoryFollowStore.listMutuals("mate")).toEqual([]);
  });
});
