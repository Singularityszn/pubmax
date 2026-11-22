import { beforeEach, describe, expect, it } from "vitest";

import type { NormalizedCheckInInput } from "@/lib/checkIn";
import { __resetMemoryCheckIns, checkInStore } from "@/lib/checkInStore";
import { __resetMemoryFollows, followStore } from "@/lib/followStore";
import { __resetMemoryProfiles, __seedMemoryOwnedProfile, type ProfileRecord } from "@/lib/profileStore";
import { clearSocialMemoryBlocks, setSocialMemoryBlock } from "@/lib/socialBlockMemory";
import { areaPublicCheckIns, visibleCheckInsForViewer } from "@/lib/socialFeed";

// The privacy choke: which check-ins reach which viewer. This is the single
// tested gate that keeps friends-only content out of public queries.

function input(over: Partial<NormalizedCheckInInput> = {}): NormalizedCheckInInput {
  return {
    handle: "karan",
    areaSlug: "shoreditch",
    venueId: null,
    note: null,
    visibility: "friends",
    ...over,
  };
}

const profiles = new Map<string, ProfileRecord>();

function owned(handle: string): ProfileRecord {
  const existing = profiles.get(handle);
  if (existing) return existing;
  const profile = __seedMemoryOwnedProfile(handle, `user-${handle}`);
  profiles.set(handle, profile);
  return profile;
}

function viewer(handle: string): { profileId: string; handle: string } {
  return { profileId: owned(handle).id, handle };
}

beforeEach(() => {
  __resetMemoryCheckIns();
  __resetMemoryFollows();
  __resetMemoryProfiles();
  clearSocialMemoryBlocks();
  profiles.clear();
});

async function mutualFollow(a: string, b: string): Promise<void> {
  owned(a);
  owned(b);
  const s = followStore();
  await s.follow(a, b);
  await s.follow(b, a);
}

describe("visibleCheckInsForViewer", () => {
  it("returns a mutual friend's check-in", async () => {
    await mutualFollow("karan", "amy");
    await checkInStore().create(input({ handle: "amy" }));
    const visible = await visibleCheckInsForViewer(viewer("karan"));
    expect(visible.map((c) => c.handle)).toEqual(["amy"]);
  });

  it("never returns a NON-mutual's check-in (one-way follow is not a friend)", async () => {
    // karan follows ben, but ben does not follow back.
    await followStore().follow("karan", "ben");
    await checkInStore().create(input({ handle: "ben" }));
    const visible = await visibleCheckInsForViewer(viewer("karan"));
    expect(visible).toEqual([]);
  });

  it("includes the viewer's own check-in", async () => {
    await checkInStore().create(input({ handle: "karan" }));
    const visible = await visibleCheckInsForViewer(viewer("karan"));
    expect(visible.map((c) => c.handle)).toEqual(["karan"]);
  });

  it.each([2, 12])("hides a mate after two hours despite a stored %ih expiry", async (hours) => {
    await mutualFollow("karan", "amy");
    const row = await checkInStore().create(input({ handle: "amy", visibility: "area" }));
    const created = Date.parse(row.createdAt);
    row.expiresAt = new Date(created + hours * 60 * 60 * 1000).toISOString();

    expect(await visibleCheckInsForViewer(viewer("karan"), created + 119 * 60_000)).toHaveLength(1);
    expect(await areaPublicCheckIns(created + 119 * 60_000)).toHaveLength(1);
    expect(await visibleCheckInsForViewer(viewer("karan"), created + 121 * 60_000)).toEqual([]);
    expect(await areaPublicCheckIns(created + 121 * 60_000)).toEqual([]);
  });

  it("returns [] for an anonymous viewer (no handle)", async () => {
    await checkInStore().create(input({ handle: "karan" }));
    expect(await visibleCheckInsForViewer({ profileId: "", handle: "" })).toEqual([]);
  });

  it("hides a mutual's check-in across a block, whichever side made it", async () => {
    await mutualFollow("ben", "ana");
    await mutualFollow("ben", "cal");
    await checkInStore().create(input({ handle: "ana", venueId: "venue-1vle947", note: "out" }));
    await checkInStore().create(input({ handle: "cal" }));
    expect((await visibleCheckInsForViewer(viewer("ben"))).map((c) => c.handle).sort())
      .toEqual(["ana", "cal"]);

    setSocialMemoryBlock(owned("ana").id, owned("ben").id, true);
    setSocialMemoryBlock(owned("ben").id, owned("cal").id, true);
    expect(await visibleCheckInsForViewer(viewer("ben"))).toEqual([]);
  });

  it("hides a mutual whose handle no account owns", async () => {
    owned("karan");
    await followStore().follow("karan", "legacy");
    await followStore().follow("legacy", "karan");
    await checkInStore().create(input({ handle: "legacy" }));
    expect(await visibleCheckInsForViewer(viewer("karan"))).toEqual([]);
  });

  it("does not leak a stranger's check-in to an unrelated viewer", async () => {
    await checkInStore().create(input({ handle: "stranger" }));
    expect(await visibleCheckInsForViewer(viewer("karan"))).toEqual([]);
  });
});

describe("areaPublicCheckIns", () => {
  it("returns ONLY 'area'-visibility check-ins — friends-only never leaks", async () => {
    await checkInStore().create(input({ handle: "karan", visibility: "friends" }));
    await checkInStore().create(input({ handle: "amy", visibility: "area" }));
    const rows = await areaPublicCheckIns();
    expect(rows.map((c) => c.handle)).toEqual(["amy"]);
    expect(rows.every((c) => c.visibility === "area")).toBe(true);
  });

  it("is empty when everything is friends-only (the default posture today)", async () => {
    await checkInStore().create(input({ handle: "karan", visibility: "friends" }));
    expect(await areaPublicCheckIns()).toEqual([]);
  });
});
