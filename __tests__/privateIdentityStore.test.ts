import { beforeEach, describe, expect, it } from "vitest";

import {
  __resetMemoryIdentityHandles,
  memoryIdentityHandleStore,
} from "@/lib/identityHandleStore";
import {
  __resetMemoryPrivateIdentities,
  memoryPrivateIdentityStore,
} from "@/lib/privateIdentityStore";
import { __resetMemoryProfiles, memoryProfileStore } from "@/lib/profileStore";

beforeEach(() => {
  __resetMemoryIdentityHandles();
  __resetMemoryPrivateIdentities();
  __resetMemoryProfiles();
});

describe("private identity store", () => {
  it("stores required date of birth with optional private details", async () => {
    const result = await memoryPrivateIdentityStore.completeOnboarding({
      userId: "user-1",
      handle: "night_owl",
      dateOfBirth: "2015-02-03",
      fullName: "Night Owl",
      sex: "prefer_not_to_say",
    });

    expect(result).toMatchObject({
      ok: true,
      handle: "night_owl",
      privateIdentity: {
        dateOfBirth: "2015-02-03",
        fullName: "Night Owl",
        sex: "prefer_not_to_say",
      },
    });
  });

  it("rejects a date that is not a date before claiming the handle", async () => {
    for (const dateOfBirth of ["not-a-date", "2035-01-01", 19900101]) {
      await expect(
        memoryPrivateIdentityStore.completeOnboarding({
          userId: "user-invalid",
          handle: "invalid_date_person",
          dateOfBirth,
        }),
      ).resolves.toMatchObject({
        ok: false,
        code: "invalid",
        error: "Enter a valid date of birth.",
      });
      await expect(
        memoryIdentityHandleStore.resolve("invalid_date_person"),
      ).resolves.toBeNull();
    }
  });

  it("claims a handle with no date of birth and writes no identity row", async () => {
    // ONE RULE (captain, 5 Sep 2026). A blank field is nothing to save, so the
    // claim goes through and `private_account_identities` stays empty for this
    // account: its `date_of_birth` is NOT NULL, so an absent answer is an
    // absent ROW rather than a null column. The age answer is the adult tap.
    for (const dateOfBirth of [undefined, null, "", "   "]) {
      __resetMemoryIdentityHandles();
      __resetMemoryPrivateIdentities();
      __resetMemoryProfiles();
      await expect(
        memoryPrivateIdentityStore.completeOnboarding({
          userId: "user-undated",
          handle: "undated_drinker",
          dateOfBirth,
        }),
      ).resolves.toMatchObject({
        ok: true,
        handle: "undated_drinker",
        privateIdentity: null,
      });
      await expect(
        memoryIdentityHandleStore.resolve("undated_drinker"),
      ).resolves.toMatchObject({ currentHandle: "undated_drinker" });
      await expect(
        memoryPrivateIdentityStore.read("user-undated"),
      ).resolves.toBeNull();
    }
  });

  it("still stores a date of birth an undated account adds later", async () => {
    expect(
      await memoryPrivateIdentityStore.completeOnboarding({
        userId: "user-later",
        handle: "later_drinker",
        dateOfBirth: null,
      }),
    ).toMatchObject({ ok: true, privateIdentity: null });

    await expect(
      memoryPrivateIdentityStore.updateDetails("user-later", {
        dateOfBirth: "1990-01-01",
        fullName: "Later Drinker",
      }),
    ).resolves.toMatchObject({
      dateOfBirth: "1990-01-01",
      fullName: "Later Drinker",
    });
  });

  it("creates the identity row for a claim-path account that has none", async () => {
    // A handle claimed through the early path stores no date of birth, so this
    // account has a profile and no private identity row at all. The save makes
    // one; it does not refuse for the row's own absence.
    await memoryProfileStore.createOwned("early_claimer", "user-claim-path");
    await expect(
      memoryPrivateIdentityStore.read("user-claim-path"),
    ).resolves.toBeNull();

    await expect(
      memoryPrivateIdentityStore.updateDetails("user-claim-path", {
        dateOfBirth: "1990-01-01",
        fullName: "Karan Founder",
      }),
    ).resolves.toMatchObject({
      dateOfBirth: "1990-01-01",
      fullName: "Karan Founder",
    });
    await expect(
      memoryPrivateIdentityStore.read("user-claim-path"),
    ).resolves.toMatchObject({ dateOfBirth: "1990-01-01" });
  });

  it("refuses a first save that carries no date of birth", async () => {
    await memoryProfileStore.createOwned("early_claimer", "user-claim-path");
    await expect(
      memoryPrivateIdentityStore.updateDetails("user-claim-path", {
        fullName: "Karan Founder",
      }),
    ).resolves.toBeNull();
    await expect(
      memoryPrivateIdentityStore.read("user-claim-path"),
    ).resolves.toBeNull();
  });

  it("updates required and optional private fields without changing ownership", async () => {
    await memoryPrivateIdentityStore.completeOnboarding({
      userId: "user-1",
      handle: "night_owl",
      dateOfBirth: "2015-02-03",
    });
    await expect(
      memoryPrivateIdentityStore.updateDetails("user-1", {
        fullName: "Night Owl",
        sex: "female",
      }),
    ).resolves.toMatchObject({
      dateOfBirth: "2015-02-03",
      fullName: "Night Owl",
      sex: "female",
    });
  });
});
