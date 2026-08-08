import { describe, expect, it } from "vitest";

import {
  decideFriendsLaunchSocialAccess,
} from "@/lib/socialAccess";
import { isAdultDateOfBirth, isSocialFriendsLaunchEnabled } from "@/lib/socialLaunch";

const NOW = "2026-08-05T20:00:00.000Z";

describe("friends-launch Social access policy", () => {
  it("keeps the launch flag off at preview", () => {
    expect(
      decideFriendsLaunchSocialAccess({
        friendsLaunchEnabled: false,
        supabaseUserId: "user-1",
        claimedHandle: "alice",
        dateOfBirth: "1990-01-01",
        ownershipState: "active",
        now: NOW,
      }),
    ).toBe("preview");
  });

  it("requires a Supabase session when the launch flag is on", () => {
    expect(
      decideFriendsLaunchSocialAccess({
        friendsLaunchEnabled: true,
        supabaseUserId: null,
        claimedHandle: null,
        dateOfBirth: null,
        ownershipState: null,
        now: NOW,
      }),
    ).toBe("sign_in_required");
  });

  it("requires a claimed handle and adult date of birth", () => {
    expect(
      decideFriendsLaunchSocialAccess({
        friendsLaunchEnabled: true,
        supabaseUserId: "user-1",
        claimedHandle: null,
        dateOfBirth: "1990-01-01",
        ownershipState: "active",
        now: NOW,
      }),
    ).toBe("age_verification_required");

    expect(
      decideFriendsLaunchSocialAccess({
        friendsLaunchEnabled: true,
        supabaseUserId: "user-1",
        claimedHandle: "alice",
        dateOfBirth: null,
        ownershipState: "active",
        now: NOW,
      }),
    ).toBe("age_verification_required");

    expect(
      decideFriendsLaunchSocialAccess({
        friendsLaunchEnabled: true,
        supabaseUserId: "user-1",
        claimedHandle: "alice",
        dateOfBirth: "2015-02-03",
        ownershipState: "active",
        now: NOW,
      }),
    ).toBe("age_verification_required");
  });

  it("grants verified access for an adult with a claimed handle", () => {
    expect(
      decideFriendsLaunchSocialAccess({
        friendsLaunchEnabled: true,
        supabaseUserId: "user-1",
        claimedHandle: "alice",
        dateOfBirth: "1990-01-01",
        ownershipState: "active",
        now: NOW,
      }),
    ).toBe("verified");
  });

  it("keeps suspended accounts closed", () => {
    expect(
      decideFriendsLaunchSocialAccess({
        friendsLaunchEnabled: true,
        supabaseUserId: "user-1",
        claimedHandle: "alice",
        dateOfBirth: "1990-01-01",
        ownershipState: "suspended",
        now: NOW,
      }),
    ).toBe("suspended");
  });
});

describe("friends-launch flag parser", () => {
  it("enables only the exact value 1", () => {
    expect(isSocialFriendsLaunchEnabled("1")).toBe(true);
    for (const value of [undefined, "", "0", "true"]) {
      expect(isSocialFriendsLaunchEnabled(value)).toBe(false);
    }
  });
});

describe("adult date of birth", () => {
  it("treats 18-year-olds as adults on their birthday", () => {
    expect(isAdultDateOfBirth("2008-08-05", Date.parse(NOW))).toBe(true);
    expect(isAdultDateOfBirth("2008-08-06", Date.parse(NOW))).toBe(false);
  });
});
