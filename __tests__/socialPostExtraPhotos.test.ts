import { describe, expect, it } from "vitest";

import { createMemorySocialPostExtraPhotoStore } from "@/lib/socialPostExtraPhotoStore";
import { isSocialPostExtraSlot, socialExtraPhotoPath } from "@/lib/socialPostPhotos";

const prepared = {
  bytes: Buffer.from("jpeg-bytes"),
  contentType: "image/jpeg" as const,
  width: 800,
  height: 1000,
  byteSize: 10,
  sha256: "a".repeat(64),
};

describe("Social extra photo rules", () => {
  it("takes slots 2 to 4 only", () => {
    expect([2, 3, 4].map(isSocialPostExtraSlot)).toEqual([true, true, true]);
    expect([1, 5, 2.5, "2"].map(isSocialPostExtraSlot)).toEqual([false, false, false, false]);
    expect(socialExtraPhotoPath("m-1")).toBe("/api/social/photos/m-1");
  });
});

describe("memory Social extra photo store", () => {
  it("holds a photo for its author until it is checked, one per slot", async () => {
    const store = createMemorySocialPostExtraPhotoStore();
    const alice = { profileId: "alice" };
    const bob = { profileId: "bob" };
    const photo = await store.attach(alice, "post-1", 2, prepared, "The snug");
    expect(photo).toMatchObject({ slot: 2, altText: "The snug", moderationState: "pending" });
    await expect(store.attach(alice, "post-1", 2, prepared, "Again")).rejects.toThrow(/already filled/);
    await expect(store.attach(bob, "post-1", 3, prepared, "Not mine")).rejects.toThrow(/not found/);

    expect((await store.forPosts(["post-1"], alice)).get("post-1")).toHaveLength(1);
    expect((await store.forPosts(["post-1"], bob)).size).toBe(0);
    expect(await store.read(bob, photo.mediaId)).toBeNull();
    expect((await store.read(alice, photo.mediaId))?.contentType).toBe("image/jpeg");

    const result = await store.processModeration({ moderate: async () => ({ decision: "approved" }) });
    expect(result).toMatchObject({ processed: 1, approved: 1 });
    expect((await store.forPosts(["post-1"], bob)).get("post-1")?.[0]?.moderationState).toBe("approved");
    expect(await store.read(bob, photo.mediaId)).not.toBeNull();
  });

  it("keeps a flagged photo with its author and retries a failed check", async () => {
    const store = createMemorySocialPostExtraPhotoStore();
    const alice = { profileId: "alice" };
    const flagged = await store.attach(alice, "post-2", 2, prepared, "Flagged");
    await store.attach(alice, "post-2", 3, prepared, "Retried");
    let calls = 0;
    const result = await store.processModeration({
      moderate: async () => {
        calls += 1;
        if (calls === 1) return { decision: "needs_review" };
        throw new Error("provider down");
      },
    });
    expect(result).toMatchObject({ processed: 1, needsReview: 1, retried: 1 });
    expect(await store.read({ profileId: "bob" }, flagged.mediaId)).toBeNull();
    expect((await store.forPosts(["post-2"], alice)).get("post-2")?.map((p) => p.moderationState)).toEqual(["needs_review", "pending"]);
  });
});
