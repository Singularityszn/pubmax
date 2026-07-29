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
  it("requires and stores a private date of birth at onboarding", async () => {
    await expect(
      memoryPrivateIdentityStore.completeOnboarding({
        userId: "user-1",
        handle: "night_owl",
        dateOfBirth: "",
      }),
    ).resolves.toMatchObject({ ok: false, code: "invalid" });

    const result = await memoryPrivateIdentityStore.completeOnboarding({
      userId: "user-1",
      handle: "night_owl",
      dateOfBirth: "2015-07-29",
      fullName: "Night Owl",
      sex: "prefer_not_to_say",
    });

    expect(result).toMatchObject({
      ok: true,
      handle: "night_owl",
      privateIdentity: {
        dateOfBirth: "2015-07-29",
        fullName: "Night Owl",
        sex: "prefer_not_to_say",
      },
    });
  });

  it("accepts every valid age and keeps only the handle public", async () => {
    const result = await memoryPrivateIdentityStore.completeOnboarding({
      userId: "user-young",
      handle: "young_person",
      dateOfBirth: "2020-01-01",
    });
    expect(result).toMatchObject({ ok: true });
    await expect(memoryPrivateIdentityStore.read("user-young")).resolves.toMatchObject({
      dateOfBirth: "2020-01-01",
    });
    await expect(memoryIdentityHandleStore.resolve("young_person")).resolves.toMatchObject({
      currentHandle: "young_person",
    });
  });

  it("updates required and optional private fields without changing ownership", async () => {
    await memoryPrivateIdentityStore.completeOnboarding({
      userId: "user-1",
      handle: "night_owl",
      dateOfBirth: "1990-01-01",
    });
    await expect(
      memoryPrivateIdentityStore.updateDetails("user-1", {
        dateOfBirth: "1991-02-03",
        fullName: "Night Owl",
        sex: "female",
      }),
    ).resolves.toMatchObject({
      dateOfBirth: "1991-02-03",
      fullName: "Night Owl",
      sex: "female",
    });
  });
});
