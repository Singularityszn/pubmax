import { afterEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";

import { createMemorySocialGalleryStore } from "@/lib/socialGalleryStore";
import { SOCIAL_GALLERY_UPLOAD_LIFETIME_MS } from "@/lib/socialGallery";
import { parseSocialGalleryEdit } from "@/lib/socialGallerySubmission";
import { createMemorySocialPostStore, type SocialPostActor } from "@/lib/socialPostStore";
import { supabaseSocialPhotoStorage } from "@/lib/socialPostMedia.server";

const alice: SocialPostActor = { accountId: "review-a", profileId: "review-profile-a", handle: "alice" };
const bob: SocialPostActor = { accountId: "review-b", profileId: "review-profile-b", handle: "bob" };
const fields = { kind: "standard" as const, visibility: "public" as const, body: "A night out", area: null,
  venueId: null, hashtags: [], commentPolicy: "open" as const };
const graph = () => ({ followingProfileIds: new Set<string>(), mutualProfileIds: new Set<string>() });

async function fixture() {
  const bytes = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#456789" } }).jpeg().toBuffer();
  return new File([new Uint8Array(bytes)], "night.jpg", { type: "image/jpeg" });
}

afterEach(() => vi.restoreAllMocks());

describe("independent gallery review", () => {
  it.each(["mediaObjectKey", "read", "readServerProjection"] as const)("%s checks the current audience after resolving relationships", async (method) => {
    let release!: (value: ReturnType<typeof graph>) => void;
    let hold = false;
    const posts = createMemorySocialPostStore({ relationships: async () => hold
      ? new Promise((resolve) => { release = resolve; }) : graph() });
    const store = createMemorySocialGalleryStore(posts);
    const file = await fixture();
    const first = await store.upload(alice, file, "review-privacy-first");
    const second = await store.upload(alice, file, "review-privacy-second");
    const post = await store.create(alice, { ...fields, gallery: [
      { ...first, altText: "First" }, { ...second, altText: "Second" },
    ] }, "review-privacy-post");
    await posts.processModerationQueue({ moderate: async () => ({ decision: "approved" }) });
    const beginRead = () => method === "mediaObjectKey" ? posts.mediaObjectKey!(bob, second.mediaId)
      : method === "read" ? posts.read(post.id, bob) : posts.readServerProjection!(post.id, bob);
    expect(await beginRead()).not.toBeNull();
    hold = true;
    const read = beginRead();
    await posts.edit(post.id, alice, 0, { visibility: "private" }, false);
    release(graph());
    expect(await read).toBeNull();
  });

  it("uses separate create and edit request namespaces like the durable RPCs", async () => {
    const posts = createMemorySocialPostStore({ relationships: async () => graph() });
    const store = createMemorySocialGalleryStore(posts);
    const upload = await store.upload(alice, await fixture(), "review-namespace-upload");
    const gallery = [{ ...upload, altText: "Our table" }];
    const key = "review-same-create-edit-key";
    const post = await store.create(alice, { ...fields, gallery }, key);
    await expect(store.edit(post.id, alice, { expectedMutationVersion: 0, visibility: "private", gallery }, key))
      .resolves.toMatchObject({ id: post.id, visibility: "private", mutationVersion: 1 });
    await expect(store.create(alice, { ...fields, gallery }, key)).resolves.toMatchObject({ id: post.id, mutationVersion: 1 });
    await expect(store.edit(post.id, alice, { expectedMutationVersion: 0, visibility: "private", gallery }, key))
      .resolves.toMatchObject({ id: post.id, mutationVersion: 1 });
    await expect(store.edit(post.id, alice, { expectedMutationVersion: 0, visibility: "public", gallery }, key))
      .rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });

  it("keeps a committed upload consumed when detached-object cleanup fails", async () => {
    const posts = createMemorySocialPostStore({ relationships: async () => graph() });
    const store = createMemorySocialGalleryStore(posts);
    const file = await fixture();
    const first = await store.upload(alice, file, "review-cleanup-first");
    const second = await store.upload(alice, file, "review-cleanup-second");
    const post = await store.create(alice, { ...fields, gallery: [{ ...first, altText: "First" }] }, "review-cleanup-post");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(supabaseSocialPhotoStorage, "remove").mockRejectedValueOnce(new Error("Storage cleanup unavailable"));
    await expect(store.edit(post.id, alice, { expectedMutationVersion: 0, gallery: [{ ...second, altText: "Second" }] }, "review-cleanup-replace"))
      .resolves.toMatchObject({ id: post.id, mutationVersion: 1, photo: { mediaId: second.mediaId } });
    expect(warn).toHaveBeenCalledExactlyOnceWith("social_photo.memory_cleanup_failed");
    await expect(posts.readOwned(post.id, alice)).resolves.toMatchObject({ mutationVersion: 1, photo: { mediaId: second.mediaId } });
    await store.edit(post.id, alice, { expectedMutationVersion: 1, gallery: [] }, "review-cleanup-remove");
    // This media was committed and then removed. Its bytes have also been deleted.
    await expect(store.create(alice, { ...fields, gallery: [{ ...second, altText: "Second reused" }] }, "review-cleanup-reuse"))
      .rejects.toMatchObject({ code: "GALLERY_UPLOAD_UNAVAILABLE" });
  });

  it("keeps removal and its replay successful when physical cleanup fails", async () => {
    const posts = createMemorySocialPostStore({ relationships: async () => graph() });
    const store = createMemorySocialGalleryStore(posts);
    const upload = await store.upload(alice, await fixture(), "review-remove-upload");
    const post = await store.create(alice, { ...fields, gallery: [{ ...upload, altText: "Our table" }] }, "review-remove-post");
    await posts.processModerationQueue({ moderate: async () => ({ decision: "approved" }) });
    expect(await posts.mediaObjectKey!(alice, upload.mediaId)).not.toBeNull();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(supabaseSocialPhotoStorage, "remove").mockRejectedValueOnce(new Error("Storage cleanup unavailable"));
    await expect(posts.remove(post.id, alice, 0, "review-remove-request")).resolves.toBe(true);
    await expect(posts.remove(post.id, alice, 0, "review-remove-request")).resolves.toBe(true);
    expect(warn).toHaveBeenCalledExactlyOnceWith("social_photo.memory_cleanup_failed");
    await expect(posts.readOwned(post.id, alice)).resolves.toBeNull();
    await expect(posts.mediaObjectKey!(alice, upload.mediaId)).resolves.toBeNull();
  });

  it("consumes a committed upload before waiting for detached-object cleanup", async () => {
    const posts = createMemorySocialPostStore({ relationships: async () => graph() });
    const store = createMemorySocialGalleryStore(posts);
    const file = await fixture();
    const first = await store.upload(alice, file, "review-pending-first");
    const second = await store.upload(alice, file, "review-pending-second");
    const post = await store.create(alice, { ...fields, gallery: [{ ...first, altText: "First" }] }, "review-pending-post");
    let release!: () => void;
    let started!: () => void;
    const cleaning = new Promise<void>((resolve) => { started = resolve; });
    vi.spyOn(supabaseSocialPhotoStorage, "remove").mockImplementationOnce(() => {
      started();
      return new Promise<void>((resolve) => { release = resolve; });
    });
    const firstEdit = store.edit(post.id, alice, { expectedMutationVersion: 0, gallery: [{ ...second, altText: "Second" }] }, "review-pending-replace");
    await cleaning;
    try {
      await expect(posts.readOwned(post.id, alice)).resolves.toMatchObject({ mutationVersion: 1, photo: { mediaId: second.mediaId } });
      await store.edit(post.id, alice, { expectedMutationVersion: 1, gallery: [] }, "review-pending-remove");
      await expect(store.create(alice, { ...fields, gallery: [{ ...second, altText: "Reused" }] }, "review-pending-reuse"))
        .rejects.toMatchObject({ code: "GALLERY_UPLOAD_UNAVAILABLE" });
    } finally {
      release();
      await firstEdit;
    }
  });

  it("retains every gallery item in caption-only edits and refuses stale privacy changes", async () => {
    const posts = createMemorySocialPostStore({ relationships: async () => graph() });
    const store = createMemorySocialGalleryStore(posts);
    const file = await fixture();
    const gallery = await Promise.all(["a", "b"].map(async (id) => ({
      ...await store.upload(alice, file, `review-caption-upload-${id}`), altText: id,
    })));
    const post = await store.create(alice, { ...fields, gallery }, "review-caption-post");
    const edited = await posts.edit(post.id, alice, 0, { body: "A later caption", visibility: "private" }, true);
    expect(edited.photos?.map((photo) => photo.mediaId)).toEqual(gallery.map((photo) => photo.mediaId));
    await expect(posts.edit(post.id, alice, 0, { body: "Stale", visibility: "public" }, true)).rejects.toMatchObject({ code: "EDIT_CONFLICT" });
    await expect(posts.readOwned(post.id, alice)).resolves.toMatchObject({ body: "A later caption", visibility: "private" });
  });

  it("mirrors a new primary when omitted from the desired gallery and replays after upload expiry", async () => {
    let now = 1_000;
    const posts = createMemorySocialPostStore({ relationships: async () => graph() });
    const store = createMemorySocialGalleryStore(posts, () => now);
    const file = await fixture();
    const first = await store.upload(alice, file, "review-primary-first");
    const second = await store.upload(alice, file, "review-primary-second");
    const gallery = [{ ...first, altText: "First" }, { ...second, altText: "Second" }];
    const payload = { ...fields, gallery };
    const post = await store.create(alice, payload, "review-primary-post");
    const parsed = parseSocialGalleryEdit({ expectedMutationVersion: 0, gallery: [gallery[1]] });
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.payload).not.toHaveProperty("visibility");
    const edited = await store.edit(post.id, alice, parsed.payload, "review-primary-edit");
    expect(edited.photo?.mediaId).toBe(second.mediaId);
    expect(edited.photos).toHaveLength(1);
    now += SOCIAL_GALLERY_UPLOAD_LIFETIME_MS;
    await expect(store.create(alice, payload, "review-primary-post")).resolves.toMatchObject({ id: post.id, mutationVersion: 1 });
    await expect(store.edit(post.id, alice, parsed.payload, "review-primary-edit")).resolves.toMatchObject({ id: post.id, mutationVersion: 1 });
  });
});
