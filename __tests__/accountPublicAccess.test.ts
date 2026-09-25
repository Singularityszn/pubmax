import { afterEach, describe, expect, it } from "vitest";

import {
  __resetMemoryAccountEnforcement,
  __setMemoryAccountEnforcement,
  filterProfilesWithdrawnFromPublic,
  profilePublicPresence,
} from "@/lib/accountPublicAccess.server";
import { projectPublicAuthors } from "@/lib/avatarResolve";
import { __resetMemoryProfiles, __seedMemoryOwnedProfile } from "@/lib/profileStore";

describe("account public access", () => {
  afterEach(() => {
    __resetMemoryAccountEnforcement();
    __resetMemoryProfiles();
  });

  it("treats a banned or suspended owner as withdrawn", async () => {
    __setMemoryAccountEnforcement("user-banned", {
      authBanned: true,
      socialSuspended: false,
    });
    await expect(
      profilePublicPresence({ userId: "user-banned", tombstonedAt: undefined }),
    ).resolves.toBe("withdrawn");
  });

  it("keeps tombstoned accounts on the gone lane", async () => {
    await expect(
      profilePublicPresence({
        userId: "user-gone",
        tombstonedAt: "2026-01-01T00:00:00.000Z",
      }),
    ).resolves.toBe("gone");
  });

  it("drops banned and suspended owners from a profile list", async () => {
    __setMemoryAccountEnforcement("user-banned", { authBanned: true, socialSuspended: false });
    __setMemoryAccountEnforcement("user-suspended", { authBanned: false, socialSuspended: true });
    const profiles = [
      { handle: "alice", userId: "user-alice" },
      { handle: "karansdad", userId: "user-banned" },
      { handle: "nikhil_x", userId: "user-suspended" },
    ];
    await expect(filterProfilesWithdrawnFromPublic(profiles)).resolves.toEqual([
      { handle: "alice", userId: "user-alice" },
    ]);
  });

  it("drops a withdrawn author's contributions from a public feed", async () => {
    __seedMemoryOwnedProfile("alice", "user-alice");
    __seedMemoryOwnedProfile("karansdad", "user-banned");
    __setMemoryAccountEnforcement("user-banned", { authBanned: true, socialSuspended: false });
    const drops = [
      { id: "1", handle: "alice" },
      { id: "2", handle: "KaransDad" },
      { id: "3", handle: "guest_drinker" },
    ];
    const projected = await projectPublicAuthors(drops);
    expect(projected.map((drop) => drop.id)).toEqual(["1", "3"]);
  });
});
