import { describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { createMemorySocialGalleryStore, socialGalleryRequestDigest } from "@/lib/socialGalleryStore";
import { createMemorySocialPostStore, type SocialPostActor } from "@/lib/socialPostStore";
import type { SocialGalleryCreate } from "@/lib/socialGallerySubmission";
import { SOCIAL_GALLERY_UPLOAD_LIFETIME_MS } from "@/lib/socialGallery";

const alice: SocialPostActor = { accountId: "account-a", profileId: "profile-a", handle: "alice" };
const bob: SocialPostActor = { accountId: "account-b", profileId: "profile-b", handle: "bob" };
const fields: Omit<SocialGalleryCreate, "gallery"> = { kind: "standard", visibility: "public", body: "A day out", area: null, venueId: null, hashtags: [], commentPolicy: "open" };
async function photo() {
  const bytes = await sharp({ create: { width: 16, height: 20, channels: 3, background: "#124512" } }).jpeg().toBuffer();
  return new File([new Uint8Array(bytes)], "day.jpg", { type: "image/jpeg" });
}
async function setup() {
  let clock = 1_000;
  const posts = createMemorySocialPostStore({ relationships: async () => ({ followingProfileIds: new Set(), mutualProfileIds: new Set() }) });
  const store = createMemorySocialGalleryStore(posts, () => clock);
  const file = await photo();
  const first = await store.upload(alice, file, "upload-first-123456");
  const second = await store.upload(alice, file, "upload-second-123456");
  const gallery = [{ ...first, altText: "At the canal" }, { ...second, altText: "In the garden" }];
  return { posts, store, file, gallery, advance: () => { clock += SOCIAL_GALLERY_UPLOAD_LIFETIME_MS; } };
}

describe("gallery publication and edit authority", () => {
  it("publishes ordered photos once, scans every image, and applies audience rules to every media read", async () => {
    const { posts, store, gallery } = await setup();
    const post = await store.create(alice, { ...fields, visibility: "private", gallery }, "create-post-123456");
    expect(post.photos?.map(item => item.mediaId)).toEqual(gallery.map(item => item.mediaId));
    expect(post.photo?.mediaId).toBe(gallery[0].mediaId);
    await expect(posts.mediaObjectKey!(alice, gallery[1].mediaId)).resolves.toBeNull();
    const moderate = vi.fn(async () => ({ decision: "approved" as const }));
    await posts.processModerationQueue({ moderate });
    expect(moderate).toHaveBeenCalledTimes(2);
    await expect(posts.mediaObjectKey!(alice, gallery[1].mediaId)).resolves.toContain(gallery[1].mediaId);
    await expect(posts.mediaObjectKey!(bob, gallery[1].mediaId)).resolves.toBeNull();
    await expect(store.create(alice, { ...fields, visibility: "private", gallery }, "create-post-123456")).resolves.toMatchObject({ id: post.id });
  });

  it("holds the whole gallery when a later image needs review", async () => {
    const { posts, store, gallery } = await setup();
    const post = await store.create(alice, { ...fields, gallery }, "create-post-123456");
    let seen = 0;
    const result = await posts.processModerationQueue({ moderate: async () => ({ decision: ++seen === 2 ? "needs_review" : "approved" }) });
    expect(result).toMatchObject({ approved: 0, needsReview: 1 });
    await expect(posts.read(post.id, bob)).resolves.toBeNull();
    for (const item of gallery) await expect(posts.mediaObjectKey!(alice, item.mediaId)).resolves.toBeNull();
  });

  it("rejects foreign, expired, and already attached uploads without publishing a partial album", async () => {
    const { posts, store, gallery, advance } = await setup();
    await expect(store.create(bob, { ...fields, gallery }, "create-foreign-123456")).rejects.toMatchObject({ code: "GALLERY_UPLOAD_UNAVAILABLE" });
    await expect(posts.feed(bob, { lane: "discover" })).resolves.toMatchObject({ posts: [] });
    await store.create(alice, { ...fields, gallery: [gallery[0]] }, "create-first-123456");
    await expect(store.create(alice, { ...fields, gallery }, "create-second-123456")).rejects.toMatchObject({ code: "GALLERY_UPLOAD_UNAVAILABLE" });
    advance();
    await expect(store.create(alice, { ...fields, gallery: [gallery[1]] }, "create-expired-123456")).rejects.toMatchObject({ code: "GALLERY_UPLOAD_UNAVAILABLE" });
  });

  it("reorders retained photos, fences stale edits, and replays an edit without a second revision", async () => {
    const { posts, store, gallery, advance } = await setup();
    const post = await store.create(alice, { ...fields, gallery }, "create-post-123456");
    advance();
    const payload = { expectedMutationVersion: 0, gallery: [...gallery].reverse() };
    const edited = await store.edit(post.id, alice, payload, "edit-reorder-123456");
    expect(edited).toMatchObject({ mutationVersion: 1, revision: 1, photo: { mediaId: gallery[1].mediaId } });
    expect(edited.photos?.map(item => item.mediaId)).toEqual([...gallery].reverse().map(item => item.mediaId));
    await expect(store.edit(post.id, alice, payload, "edit-reorder-123456")).resolves.toMatchObject({ mutationVersion: 1 });
    await expect(store.edit(post.id, alice, { ...payload, gallery }, "edit-reorder-123456")).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    await expect(store.edit(post.id, alice, { ...payload, visibility: "public" }, "edit-stale-123456")).rejects.toMatchObject({ code: "EDIT_CONFLICT" });
    await posts.processModerationQueue({ moderate: async () => ({ decision: "approved" }) });
    for (const item of gallery) await expect(posts.mediaObjectKey!(alice, item.mediaId)).resolves.toBeTruthy();
  });

  it("removes all gallery media while allowing the remaining text to pass moderation", async () => {
    const { posts, store, gallery } = await setup();
    const post = await store.create(alice, { ...fields, gallery }, "create-post-123456");
    const edited = await store.edit(post.id, alice, { expectedMutationVersion: 0, gallery: [] }, "edit-remove-123456");
    expect(edited).toMatchObject({ photo: null, photos: [], revision: 1 });
    await posts.processModerationQueue({ moderate: async ({ imageUrl }) => { expect(imageUrl).toBeUndefined(); return { decision: "approved" }; } });
    await expect(posts.read(post.id, bob)).resolves.toMatchObject({ photos: [] });
    for (const item of gallery) await expect(posts.mediaObjectKey!(alice, item.mediaId)).resolves.toBeNull();
  });

  it("does not permit concurrent posts to attach the same photo", async () => {
    const { store, gallery } = await setup();
    const results = await Promise.allSettled([
      store.create(alice, { ...fields, gallery }, "create-race-one-123456"),
      store.create(alice, { ...fields, gallery }, "create-race-two-123456"),
    ]);
    expect(results.filter(item => item.status === "fulfilled")).toHaveLength(1);
    expect(results.filter(item => item.status === "rejected")).toHaveLength(1);
  });

  it("pins ordered descriptions in the request digest", () => {
    const gallery = [{ mediaId: "a", altText: "one" }, { mediaId: "b", altText: "two" }];
    expect(socialGalleryRequestDigest({ ...fields, gallery })).not.toBe(socialGalleryRequestDigest({ ...fields, gallery: [...gallery].reverse() }));
    expect(socialGalleryRequestDigest({ ...fields, gallery })).toBe(socialGalleryRequestDigest({ gallery, ...fields }));
  });
});
