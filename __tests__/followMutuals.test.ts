import { beforeEach, describe, expect, it } from "vitest";

import { __resetMemoryFollows, followStore } from "@/lib/followStore";
import { __resetMemoryProfiles } from "@/lib/profileStore";

beforeEach(() => {
  __resetMemoryFollows();
  __resetMemoryProfiles();
});

describe("followStore mutuals (the 'your lot' graph)", () => {
  it("listFollowers mirrors listFollowing", async () => {
    const store = followStore();
    await store.follow("amy", "karan");
    expect(await store.listFollowing("amy")).toEqual(["karan"]);
    expect(await store.listFollowers("karan")).toEqual(["amy"]);
  });

  it("listMutuals returns only handles in a two-way follow", async () => {
    const store = followStore();
    // karan <-> amy is mutual; karan -> ben is one-way only.
    await store.follow("karan", "amy");
    await store.follow("amy", "karan");
    await store.follow("karan", "ben");

    const lot = await store.listMutuals("karan");
    expect(lot).toEqual(["amy"]);
    // ben, a one-way follow, is NOT in the lot.
    expect(lot).not.toContain("ben");
  });

  it("returns [] for an unknown handle", async () => {
    expect(await followStore().listMutuals("nobody")).toEqual([]);
    expect(await followStore().listFollowers("nobody")).toEqual([]);
  });

  it("unfollow drops a handle out of the lot", async () => {
    const store = followStore();
    await store.follow("karan", "amy");
    await store.follow("amy", "karan");
    expect(await store.listMutuals("karan")).toEqual(["amy"]);
    await store.unfollow("amy", "karan");
    expect(await store.listMutuals("karan")).toEqual([]);
  });

  it("mutualsAmong answers each named handle's lot, and an empty lot for a stranger", async () => {
    const store = followStore();
    await store.follow("karan", "amy");
    await store.follow("amy", "karan");
    await store.follow("amy", "ben");
    await store.follow("ben", "amy");
    await store.follow("amy", "zoe");

    const lots = await store.mutualsAmong(["@Amy", "ben", "nobody"]);
    expect(lots.get("amy")?.sort()).toEqual(["ben", "karan"]);
    expect(lots.get("ben")).toEqual(["amy"]);
    expect(lots.get("nobody")).toEqual([]);
  });
});
