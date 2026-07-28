import { beforeEach, describe, expect, it } from "vitest";

import {
  __resetMemoryReferrals,
  memoryReferralStore,
} from "@/lib/referralStore";

const DAY = 24 * 60 * 60 * 1_000;
const START = Date.parse("2026-07-28T10:00:00.000Z");

beforeEach(() => {
  __resetMemoryReferrals();
});

describe("referral attribution store", () => {
  it("keeps first-touch attribution through a delayed signup", async () => {
    const first = await memoryReferralStore.getOrCreateInviteCode("inviter-a");
    const second = await memoryReferralStore.getOrCreateInviteCode("inviter-b");

    const journey = await memoryReferralStore.startJourney(first.code, null, START);
    expect(journey).not.toBeNull();
    const retained = await memoryReferralStore.startJourney(
      second.code,
      journey!.token,
      START + DAY,
    );
    expect(retained?.token).toBe(journey?.token);

    const claimed = await memoryReferralStore.claimJourney({
      token: journey!.token,
      inviteeUserId: "invitee",
      inviteeCreatedAt: new Date(START + DAY).toISOString(),
      now: START + DAY,
    });
    expect(claimed).toMatchObject({ ok: true, status: "recorded" });
    expect(await memoryReferralStore.privateStatus("inviter-a")).toMatchObject({
      attributedCount: 1,
      qualifiedCount: 0,
    });
    expect(await memoryReferralStore.privateStatus("inviter-b")).toMatchObject({
      attributedCount: 0,
    });
  });

  it("does not attribute when the account predates the invite click", async () => {
    const { code } = await memoryReferralStore.getOrCreateInviteCode("inviter");
    const journey = await memoryReferralStore.startJourney(code, null, START);

    expect(
      await memoryReferralStore.claimJourney({
        token: journey!.token,
        inviteeUserId: "existing-user",
        inviteeCreatedAt: new Date(START - 1).toISOString(),
        now: START + DAY,
      }),
    ).toEqual({ ok: false, reason: "account_predates_journey" });
  });

  it("expires an unclaimed browser journey after 30 days", async () => {
    const { code } = await memoryReferralStore.getOrCreateInviteCode("inviter");
    const journey = await memoryReferralStore.startJourney(code, null, START);

    expect(
      await memoryReferralStore.claimJourney({
        token: journey!.token,
        inviteeUserId: "late-user",
        inviteeCreatedAt: new Date(START + 31 * DAY).toISOString(),
        now: START + 31 * DAY,
      }),
    ).toEqual({ ok: false, reason: "expired" });
  });

  it("rejects same-account and direct circular edges before they can qualify", async () => {
    expect(
      await memoryReferralStore.recordEdge("user-a", "user-a", START),
    ).toEqual({ ok: false, reason: "self" });

    expect(
      await memoryReferralStore.recordEdge("user-a", "user-b", START),
    ).toMatchObject({ ok: true, status: "recorded" });
    expect(
      await memoryReferralStore.recordEdge("user-b", "user-a", START + 1),
    ).toEqual({ ok: false, reason: "circular" });

    expect(
      await memoryReferralStore.qualify({
        inviteeUserId: "user-a",
        contributionKind: "community_price",
        contributionId: "price-a",
        acceptedAt: START + 2,
      }),
    ).toEqual({ ok: false, reason: "no_edge" });
    expect(await memoryReferralStore.privateStatus("user-a")).toMatchObject({
      qualifiedCount: 0,
      earned: [],
      grantedFeatures: [],
    });
  });

  it("records one immutable inviter per invited account", async () => {
    await memoryReferralStore.recordEdge("inviter-a", "invitee", START);

    expect(
      await memoryReferralStore.recordEdge("inviter-b", "invitee", START + 1),
    ).toEqual({ ok: false, reason: "already_attributed" });
    expect(
      await memoryReferralStore.recordEdge("inviter-a", "invitee", START + 2),
    ).toMatchObject({ ok: true, status: "existing" });
  });

  it("qualifies only the first accepted contribution and appends 1, 3 and 5 milestones", async () => {
    for (let index = 1; index <= 5; index += 1) {
      const invitee = `invitee-${index}`;
      await memoryReferralStore.recordEdge("inviter", invitee, START + index);
      const result = await memoryReferralStore.qualify({
        inviteeUserId: invitee,
        contributionKind: "community_price",
        contributionId: `price-${index}`,
        acceptedAt: START + DAY + index,
      });
      expect(result).toMatchObject({ ok: true, status: "qualified" });
    }

    expect(
      await memoryReferralStore.qualify({
        inviteeUserId: "invitee-1",
        contributionKind: "visit_report",
        contributionId: "visit-1",
        acceptedAt: START + 2 * DAY,
      }),
    ).toEqual({ ok: true, status: "existing" });

    const status = await memoryReferralStore.privateStatus("inviter");
    expect(status.qualifiedCount).toBe(5);
    expect(status.earned.map(({ milestone, feature, grantStatus }) => [
      milestone,
      feature,
      grantStatus,
    ])).toEqual([
      [1, "collaborative_night_credit", "blocked_identity"],
      [3, "continuing_memories", "blocked_identity"],
      [5, "post_trial_collaboration", "blocked_identity"],
    ]);
    expect(status.grantedFeatures).toEqual([]);
  });

  it("returns aggregate private status without exposing either side of an edge", async () => {
    await memoryReferralStore.recordEdge("inviter-secret", "invitee-secret", START);
    const status = await memoryReferralStore.privateStatus("inviter-secret");
    const serialized = JSON.stringify(status);

    expect(serialized).not.toContain("inviter-secret");
    expect(serialized).not.toContain("invitee-secret");
  });

  it("erases every private referral record tied to a deleted account", async () => {
    await memoryReferralStore.recordEdge("inviter", "deleted-user", START);
    await memoryReferralStore.qualify({
      inviteeUserId: "deleted-user",
      contributionKind: "visit_report",
      contributionId: "visit-deleted",
      acceptedAt: START + 1,
    });

    await memoryReferralStore.eraseAccount("deleted-user");

    expect(await memoryReferralStore.privateStatus("inviter")).toMatchObject({
      attributedCount: 0,
      qualifiedCount: 0,
      earned: [],
      grantedFeatures: [],
    });
  });
});
