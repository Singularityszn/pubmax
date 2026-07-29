import { beforeEach, describe, expect, it } from "vitest";

import {
  __resetMemoryIdentityHandles,
  memoryIdentityHandleStore,
} from "@/lib/identityHandleStore";
import {
  __resetMemoryPrivateIdentities,
  memoryPrivateIdentityStore,
} from "@/lib/privateIdentityStore";
import { __resetMemoryProfiles } from "@/lib/profileStore";

beforeEach(() => {
  __resetMemoryIdentityHandles();
  __resetMemoryPrivateIdentities();
  __resetMemoryProfiles();
});

describe("private identity store", () => {
  it("finishes onboarding with handle alone and optional private details", async () => {
    const result = await memoryPrivateIdentityStore.completeOnboarding({
      userId: "user-1",
      handle: "night_owl",
      fullName: "Night Owl",
      sex: "prefer_not_to_say",
    });

    expect(result).toMatchObject({
      ok: true,
      handle: "night_owl",
      privateIdentity: {
        fullName: "Night Owl",
        sex: "prefer_not_to_say",
      },
    });
    expect(JSON.stringify(result)).not.toContain("dateOfBirth");
  });

  it("discards an adult date of birth after retaining eligibility", async () => {
    await memoryPrivateIdentityStore.completeOnboarding({
      userId: "user-adult",
      handle: "adult_person",
    });
    await expect(
      memoryPrivateIdentityStore.assessContributionAge(
        "user-adult",
        "1990-01-01",
        Date.UTC(2026, 6, 29),
      ),
    ).resolves.toEqual({ status: "adult" });
    const stored = await memoryPrivateIdentityStore.read("user-adult");
    expect(stored).toMatchObject({ adultConfirmed: true });
    expect(JSON.stringify(stored)).not.toContain("1990-01-01");
    expect(JSON.stringify(stored)).not.toContain("dateOfBirth");
  });

  it("retains only the date an under-18 account becomes eligible", async () => {
    await memoryPrivateIdentityStore.completeOnboarding({
      userId: "user-young",
      handle: "young_person",
    });
    await expect(
      memoryPrivateIdentityStore.assessContributionAge(
        "user-young",
        "2020-01-01",
        Date.UTC(2026, 6, 29),
      ),
    ).resolves.toEqual({
      status: "underage",
      eligibleFrom: "2038-01-01",
    });
    const stored = await memoryPrivateIdentityStore.read("user-young");
    expect(stored).toMatchObject({ contributionEligibleFrom: "2038-01-01" });
    expect(JSON.stringify(stored)).not.toContain("2020-01-01");
    await expect(memoryIdentityHandleStore.resolve("young_person")).resolves.toMatchObject({
      currentHandle: "young_person",
    });
  });

  it("does not replace a completed age assessment", async () => {
    await memoryPrivateIdentityStore.completeOnboarding({
      userId: "user-locked",
      handle: "locked_person",
    });
    await memoryPrivateIdentityStore.assessContributionAge(
      "user-locked",
      "2020-01-01",
      Date.UTC(2026, 6, 29),
    );
    await expect(
      memoryPrivateIdentityStore.assessContributionAge(
        "user-locked",
        "1990-01-01",
        Date.UTC(2026, 6, 29),
      ),
    ).resolves.toEqual({
      status: "underage",
      eligibleFrom: "2038-01-01",
    });
    await expect(memoryPrivateIdentityStore.read("user-locked")).resolves.toMatchObject({
      contributionEligibleFrom: "2038-01-01",
    });
  });

  it("updates required and optional private fields without changing ownership", async () => {
    await memoryPrivateIdentityStore.completeOnboarding({
      userId: "user-1",
      handle: "night_owl",
    });
    await expect(
      memoryPrivateIdentityStore.updateDetails("user-1", {
        fullName: "Night Owl",
        sex: "female",
      }),
    ).resolves.toMatchObject({
      fullName: "Night Owl",
      sex: "female",
    });
  });
});
