import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return {
    ...actual,
    isSupabaseConfigured: () => false,
    requiresSupabaseStore: () => false,
  };
});

import {
  __resetMemoryIdentityHandles,
  memoryIdentityHandleStore,
} from "@/lib/identityHandleStore";
import {
  __resetMemoryPrivateIdentities,
  memoryPrivateIdentityStore,
} from "@/lib/privateIdentityStore";
import {
  __resetMemoryProfiles,
  memoryProfileStore,
} from "@/lib/profileStore";
import {
  __resetCommunityPrices,
  memoryCommunityPriceStore,
} from "@/lib/communityPriceStore";

beforeEach(() => {
  __resetMemoryProfiles();
  __resetMemoryIdentityHandles();
  __resetMemoryPrivateIdentities();
  __resetCommunityPrices();
});

describe("private account identity", () => {
  it("claims a new handle and keeps optional details out of the public profile", async () => {
    const result = await memoryPrivateIdentityStore.completeOnboarding({
      userId: "user-1",
      handle: "night_owl",
      fullName: "  Nina Owl  ",
      sex: "female",
    });

    expect(result).toMatchObject({
      ok: true,
      handle: "night_owl",
      privateIdentity: {
        fullName: "Nina Owl",
        sex: "female",
      },
    });
    const profile = await memoryProfileStore.getByUserId("user-1");
    expect(profile).toMatchObject({ handle: "night_owl", userId: "user-1" });
    expect(profile).not.toHaveProperty("fullName");
    expect(profile).not.toHaveProperty("sex");
  });

  it("edits or clears private optional details without changing the public profile", async () => {
    await memoryPrivateIdentityStore.completeOnboarding({
      userId: "user-1",
      handle: "private_person",
      fullName: "Old Name",
      sex: "female",
    });

    const updated = await memoryPrivateIdentityStore.updateDetails("user-1", {
      fullName: "New Name",
      sex: "",
    });
    expect(updated).toMatchObject({ fullName: "New Name" });
    expect(updated).not.toHaveProperty("sex");
    expect(await memoryProfileStore.getByUserId("user-1")).not.toHaveProperty(
      "fullName",
    );
  });

  it("makes an existing unlinked handle claimable and links its profile in place", async () => {
    const legacy = await memoryProfileStore.ensure("old_timer");
    await memoryCommunityPriceStore.submit({
      venueId: "legacy-pub",
      drinkCategory: "beer",
      priceGbp: 5.2,
      actor: "legacy-device",
      contributorHandle: "old_timer",
    });

    await expect(
      memoryIdentityHandleStore.availability("old_timer"),
    ).resolves.toEqual({ handle: "old_timer", available: true });

    const claimed = await memoryPrivateIdentityStore.completeOnboarding({
      userId: "user-1",
      handle: "old_timer",
    });
    expect(claimed).toMatchObject({
      ok: true,
      profileId: legacy.id,
      handle: "old_timer",
    });
    expect(await memoryProfileStore.getByUserId("user-1")).toMatchObject({
      id: legacy.id,
      handle: "old_timer",
    });
    expect(
      (await memoryCommunityPriceStore.listLeaderboardContributions()).records,
    ).toMatchObject([
      {
        handle: "old_timer",
        lane: "price",
        visible: true,
      },
    ]);
  });

  it("gives a handle to the first verified claimant", async () => {
    expect(
      await memoryPrivateIdentityStore.completeOnboarding({
        userId: "user-1",
        handle: "first_pint",
      }),
    ).toMatchObject({ ok: true });

    expect(
      await memoryPrivateIdentityStore.completeOnboarding({
        userId: "user-2",
        handle: "first_pint",
      }),
    ).toEqual({
      ok: false,
      code: "taken",
      error: "That handle is already taken.",
    });
  });

  it("stores adult verification without retaining date of birth", async () => {
    await memoryPrivateIdentityStore.completeOnboarding({
      userId: "user-1",
      handle: "adult_person",
    });
    await memoryPrivateIdentityStore.recordAgeAssessment(
      "user-1",
      { ok: true, status: "adult" },
      Date.UTC(2026, 6, 29, 12),
    );

    const record = await memoryPrivateIdentityStore.read("user-1");
    expect(record).toMatchObject({
      adultVerified: true,
    });
    expect(record).not.toHaveProperty("dateOfBirth");
    await expect(
      memoryPrivateIdentityStore.contributionGate("user-1"),
    ).resolves.toEqual({ status: "eligible" });
  });

  it("records age for an account that already owned a profile before private identity landed", async () => {
    await memoryProfileStore.linkUser("existing_person", "user-1");

    await expect(
      memoryPrivateIdentityStore.contributionGate("user-1"),
    ).resolves.toEqual({ status: "age_required" });
    await expect(
      memoryPrivateIdentityStore.recordAgeAssessment("user-1", {
        ok: true,
        status: "adult",
      }),
    ).resolves.toMatchObject({ adultVerified: true });
    await expect(
      memoryPrivateIdentityStore.contributionGate("user-1"),
    ).resolves.toEqual({ status: "eligible" });
  });

  it("stores only the date an under-18 becomes eligible", async () => {
    await memoryPrivateIdentityStore.completeOnboarding({
      userId: "user-1",
      handle: "young_person",
    });
    await memoryPrivateIdentityStore.recordAgeAssessment("user-1", {
      ok: true,
      status: "underage",
      eligibleOn: "2026-07-30",
    });

    const record = await memoryPrivateIdentityStore.read("user-1");
    expect(record).toMatchObject({ contributionEligibleOn: "2026-07-30" });
    expect(record).not.toHaveProperty("dateOfBirth");
    await expect(
      memoryPrivateIdentityStore.contributionGate(
        "user-1",
        Date.UTC(2026, 6, 29, 12),
      ),
    ).resolves.toEqual({
      status: "underage",
      eligibleOn: "2026-07-30",
    });
  });

  it("promotes an under-18 gate automatically when its retained eligibility date arrives", async () => {
    await memoryPrivateIdentityStore.completeOnboarding({
      userId: "user-1",
      handle: "birthday_person",
    });
    await memoryPrivateIdentityStore.recordAgeAssessment("user-1", {
      ok: true,
      status: "underage",
      eligibleOn: "2026-07-30",
    });

    await expect(
      memoryPrivateIdentityStore.contributionGate(
        "user-1",
        Date.UTC(2026, 6, 30, 0),
      ),
    ).resolves.toEqual({ status: "eligible" });
    expect(await memoryPrivateIdentityStore.read("user-1")).toMatchObject({
      adultVerified: true,
      contributionEligibleOn: undefined,
    });
  });
});
