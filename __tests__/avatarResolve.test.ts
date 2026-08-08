import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return { ...actual, isSupabaseConfigured: () => false };
});

import {
  attachAvatarUrls,
  avatarInitialFromHandle,
  enrichItemsWithAvatarUrls,
  profileMayWearAvatar,
  resolveAvatarUrlsForHandles,
} from "@/lib/avatarResolve";
import {
  __resetMemoryProfiles,
  __tombstoneMemoryProfile,
  memoryProfileStore,
  publicOwnedAvatarUrl,
} from "@/lib/profileStore";
import { profileAvatarServingKey } from "@/lib/profileAvatarMedia.server";

const GENERATION = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

async function seedApproved(handle: string, userId: string) {
  await memoryProfileStore.createOwned(handle, userId);
  const profile = await memoryProfileStore.getByHandle(handle);
  return memoryProfileStore.setOwnedAvatar(handle, {
    objectKey: profileAvatarServingKey(profile!.id, GENERATION),
    generation: GENERATION,
    moderationState: "approved",
  });
}

beforeEach(() => {
  __resetMemoryProfiles();
});

describe("avatarResolve", () => {
  it("derives initials from the handle", () => {
    expect(avatarInitialFromHandle("alice")).toBe("A");
    expect(avatarInitialFromHandle("")).toBe("?");
  });

  it("refuses unlinked or tombstoned profiles", async () => {
    await memoryProfileStore.ensure("ghost");
    const unlinked = await memoryProfileStore.getByHandle("ghost");
    expect(profileMayWearAvatar(unlinked)).toBe(false);

    await seedApproved("live", "uid-1");
    const linked = await memoryProfileStore.getByHandle("live");
    expect(profileMayWearAvatar(linked)).toBe(true);
    __tombstoneMemoryProfile("live");
    const tomb = await memoryProfileStore.getByHandle("live");
    expect(profileMayWearAvatar(tomb)).toBe(false);
  });

  it("batch-resolves handles in one store call", async () => {
    const getSpy = vi.spyOn(memoryProfileStore, "getApprovedAvatarUrlsByHandles");
    await seedApproved("alice", "uid-a");
    await seedApproved("bob", "uid-b");
    await memoryProfileStore.ensure("unlinked");

    const urls = await resolveAvatarUrlsForHandles(["alice", "bob", "unlinked", "alice"]);
    expect(getSpy).toHaveBeenCalledTimes(1);
    expect(urls.get("alice")).toBe(publicOwnedAvatarUrl((await memoryProfileStore.getByHandle("alice"))!));
    expect(urls.get("bob")).toBe(publicOwnedAvatarUrl((await memoryProfileStore.getByHandle("bob"))!));
    expect(urls.has("unlinked")).toBe(false);

    const enriched = await enrichItemsWithAvatarUrls([
      { handle: "alice", id: "1" },
      { handle: "unlinked", id: "2" },
    ]);
    expect(enriched[0].avatarUrl).toBe(urls.get("alice"));
    expect(enriched[1].avatarUrl).toBeUndefined();

    const attached = attachAvatarUrls(
      [{ handle: "bob" }],
      urls,
    );
    expect(attached[0].avatarUrl).toBe(urls.get("bob"));

    getSpy.mockRestore();
  });
});
