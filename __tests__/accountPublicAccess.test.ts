import { afterEach, describe, expect, it } from "vitest";

import {
  __resetMemoryProfileSuspensions,
  __setMemoryProfileSuspended,
  filterProfilesWithdrawnFromPublic,
  profilePublicPresence,
} from "@/lib/accountPublicAccess.server";
import { projectPublicAuthors } from "@/lib/avatarResolve";
import { __resetPintDrops, addPintDrop } from "@/lib/pintDrops";
import { memoryPintDropStore } from "@/lib/pintDropsStore";
import { __resetMemoryProfiles, __seedMemoryOwnedProfile } from "@/lib/profileStore";

function suspend(handle: string): void {
  __setMemoryProfileSuspended(__seedMemoryOwnedProfile(handle, `user-${handle}`), true);
}

describe("account public access", () => {
  afterEach(() => {
    __resetMemoryProfileSuspensions();
    __resetMemoryProfiles();
    __resetPintDrops();
  });

  it("treats a suspended profile as withdrawn", async () => {
    __setMemoryProfileSuspended({ id: "profile-suspended", handle: "karansdad" }, true);
    await expect(
      profilePublicPresence({ id: "profile-suspended", tombstonedAt: undefined }),
    ).resolves.toBe("withdrawn");
    await expect(
      profilePublicPresence({ id: "profile-live", tombstonedAt: undefined }),
    ).resolves.toBe("visible");
  });

  it("keeps tombstoned accounts on the gone lane", async () => {
    await expect(
      profilePublicPresence({
        id: "profile-gone",
        tombstonedAt: "2026-01-01T00:00:00.000Z",
      }),
    ).resolves.toBe("gone");
  });

  it("drops suspended owners from a profile list", async () => {
    __setMemoryProfileSuspended({ id: "profile-karansdad", handle: "karansdad" }, true);
    const profiles = [
      { id: "profile-alice", handle: "alice" },
      { id: "profile-karansdad", handle: "karansdad" },
    ];
    await expect(filterProfilesWithdrawnFromPublic(profiles)).resolves.toEqual([
      { id: "profile-alice", handle: "alice" },
    ]);
  });

  it("drops a suspended author's items from a projected feed", async () => {
    __seedMemoryOwnedProfile("alice", "user-alice");
    suspend("karansdad");
    const items = [
      { id: "1", handle: "alice" },
      { id: "2", handle: "KaransDad" },
      { id: "3", handle: "guest_drinker" },
    ];
    const projected = await projectPublicAuthors(items);
    expect(projected.map((item) => item.id)).toEqual(["1", "3"]);
  });

  it("withholds a suspended author's named and anonymous drops at the store", async () => {
    suspend("karansdad");
    const base = {
      venueId: "the-crown",
      drink: "",
      priceGbp: 4.2,
      passedDownNote: "",
      era: "",
      provenance: "contributor" as const,
      status: "visible" as const,
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    addPintDrop({ ...base, id: "named", handle: "karansdad" });
    addPintDrop({ ...base, id: "anon", handle: "karansdad", visibility: "anonymous" });
    addPintDrop({ ...base, id: "alice", handle: "alice" });

    const venue = await memoryPintDropStore.listVisible("the-crown");
    expect(venue.map((drop) => drop.id)).toEqual(["alice"]);
    const authored = await memoryPintDropStore.listVisible(undefined, undefined, "karansdad");
    expect(authored).toEqual([]);
  });
});
