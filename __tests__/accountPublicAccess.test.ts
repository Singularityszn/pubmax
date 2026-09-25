import { afterEach, describe, expect, it } from "vitest";

import {
  __resetMemoryProfileWithdrawals,
  __setMemoryProfileWithdrawn,
  filterProfilesWithdrawnFromPublic,
  profilePublicPresence,
} from "@/lib/accountPublicAccess.server";
import { projectPublicAuthors } from "@/lib/avatarResolve";
import { getPintDropById } from "@/lib/pintDropLookup";
import { __resetPintDrops, addPintDrop } from "@/lib/pintDrops";
import { memoryPintDropStore } from "@/lib/pintDropsStore";
import {
  __resetMemoryProfiles,
  __seedMemoryOwnedProfile,
  __tombstoneMemoryProfile,
  type ProfileRecord,
} from "@/lib/profileStore";

function withdraw(handle: string): ProfileRecord {
  const profile = __seedMemoryOwnedProfile(handle, `user-${handle}`);
  __setMemoryProfileWithdrawn(profile.id, true);
  return profile;
}

const DROP = {
  venueId: "the-crown",
  drink: "",
  priceGbp: 4.2,
  passedDownNote: "",
  era: "",
  provenance: "contributor" as const,
  status: "visible" as const,
  createdAt: "2026-01-01T00:00:00.000Z",
};

describe("account public access", () => {
  afterEach(() => {
    __resetMemoryProfileWithdrawals();
    __resetMemoryProfiles();
    __resetPintDrops();
  });

  it("treats a withdrawn live profile as withdrawn", async () => {
    const karansdad = withdraw("karansdad");
    const alice = __seedMemoryOwnedProfile("alice", "user-alice");
    await expect(profilePublicPresence(karansdad)).resolves.toBe("withdrawn");
    await expect(profilePublicPresence(alice)).resolves.toBe("visible");
  });

  it("answers a deleted account as gone, never withdrawn", async () => {
    withdraw("departed");
    const tombstoned = __tombstoneMemoryProfile("departed");
    await expect(profilePublicPresence(tombstoned)).resolves.toBe("gone");
  });

  it("drops withdrawn owners from a profile list", async () => {
    const alice = __seedMemoryOwnedProfile("alice", "user-alice");
    const karansdad = withdraw("karansdad");
    await expect(filterProfilesWithdrawnFromPublic([alice, karansdad])).resolves.toEqual([alice]);
  });

  it("drops a withdrawn author's items from a projected feed", async () => {
    __seedMemoryOwnedProfile("alice", "user-alice");
    withdraw("karansdad");
    const items = [
      { id: "1", handle: "alice" },
      { id: "2", handle: "KaransDad" },
      { id: "3", handle: "guest_drinker" },
    ];
    const projected = await projectPublicAuthors(items);
    expect(projected.map((item) => item.id)).toEqual(["1", "3"]);
  });

  it("withholds a withdrawn author's named and anonymous drops at the store", async () => {
    withdraw("karansdad");
    addPintDrop({ ...DROP, id: "named", handle: "karansdad" });
    addPintDrop({ ...DROP, id: "anon", handle: "karansdad", visibility: "anonymous" });
    addPintDrop({ ...DROP, id: "alice", handle: "alice" });

    const venue = await memoryPintDropStore.listVisible("the-crown");
    expect(venue.map((drop) => drop.id)).toEqual(["alice"]);
    const authored = await memoryPintDropStore.listVisible(undefined, undefined, "karansdad");
    expect(authored).toEqual([]);
    await expect(getPintDropById("anon")).resolves.toBeNull();
    await expect(getPintDropById("named")).resolves.toBeNull();
  });

  it("keeps a deleted author's retired drops public", async () => {
    withdraw("departed");
    __tombstoneMemoryProfile("departed");
    addPintDrop({
      ...DROP,
      id: "retired",
      handle: "departed",
      authorRetiredAt: "2026-02-01T00:00:00.000Z",
    });

    const venue = await memoryPintDropStore.listVisible("the-crown");
    expect(venue.map((drop) => drop.id)).toEqual(["retired"]);
  });
});
