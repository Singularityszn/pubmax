import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  calls: [] as Array<{ name: string; input: Record<string, unknown> }>,
  ready: false, readyWrite: true, missing: false,
  upload: vi.fn(), cleanup: vi.fn(),
}));
const actor = { profileId: "11111111-1111-4111-8111-111111111111", accountId: "account", handle: "alice" };
const mediaId = "22222222-2222-4222-8222-222222222222";
const generation = "33333333-3333-4333-8333-333333333333";
vi.mock("@/lib/socialPostIdempotency.server", () => ({ socialPhotoMediaId: () => "22222222-2222-4222-8222-222222222222" }));
vi.mock("@/lib/socialPostMedia.server", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/socialPostMedia.server")>(),
  prepareSocialPhoto: async () => ({ bytes: Buffer.from("jpeg"), contentType: "image/jpeg", width: 20, height: 20, byteSize: 4, sha256: "a".repeat(64) }),
  reserveSocialPhotoUpload: async () => ({ mediaId: "22222222-2222-4222-8222-222222222222", generation: "33333333-3333-4333-8333-333333333333", objectKey: "private/object.jpg" }),
  uploadPreparedSocialPhoto: state.upload,
  reconcileSocialPhotoUpload: state.cleanup,
}));
vi.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => true, requiresSupabaseStore: () => true,
  requireSupabaseAdmin: () => ({ rpc: async (name: string, input: Record<string, unknown>) => {
    state.calls.push({ name, input });
    if (state.missing) return { data: null, error: { code: "PGRST202", message: "RPC missing" } };
    if (name === "read_social_gallery_uploads") return { data: state.ready ? [{ media_id: "22222222-2222-4222-8222-222222222222" }] : [], error: null };
    if (name === "mark_social_gallery_upload_ready") return { data: state.readyWrite, error: null };
    if (name.endsWith("gallery_idempotent")) {
      const post = {
        id: "44444444-4444-4444-8444-444444444444", author_profile_id: input.p_actor, author_handle: "alice",
        kind: "standard", visibility: "friends", status: "visible", body: "A day out", area_slug: null, venue_id: null,
        hashtags: [], comment_policy: "open", photo_media_id: "22222222-2222-4222-8222-222222222222", photo_alt_text: "Canal",
        gallery_photos: [{ mediaId: "22222222-2222-4222-8222-222222222222", altText: "Canal" }],
        moderation_state: "pending", revision: 1, mutation_version: 1, created_at: "2026-09-07T12:00:00Z", updated_at: "2026-09-07T12:00:00Z",
      };
      return { error: null, data: name.startsWith("edit_")
        ? [{ post, from_mutation_version: 0, to_mutation_version: 0 }]
        : [post] };
    }
    throw new Error(`Unexpected RPC ${name}`);
  } }),
}));
import { socialGalleryStore } from "@/lib/socialGalleryStore";

beforeEach(() => {
  state.calls = []; state.ready = false; state.readyWrite = true; state.missing = false;
  state.upload.mockReset().mockResolvedValue({}); state.cleanup.mockReset().mockResolvedValue(true);
});

describe("durable gallery upload and mutation protocol", () => {
  it("writes private bytes before marking the owned generation ready", async () => {
    state.upload.mockImplementation(async () => { expect(state.calls.map(item => item.name)).toEqual(["read_social_gallery_uploads"]); });
    await expect(socialGalleryStore().upload(actor, new File(["photo"], "photo.jpg"), "upload-key-123456")).resolves.toEqual({ mediaId });
    expect(state.calls.at(-1)).toEqual({ name: "mark_social_gallery_upload_ready", input: { p_owner_profile_id: actor.profileId, p_media_id: mediaId, p_generation: generation } });
    expect(state.cleanup).not.toHaveBeenCalled();
  });
  it("replays a ready upload without replacing bytes", async () => {
    state.ready = true;
    await expect(socialGalleryStore().upload(actor, new File(["photo"], "photo.jpg"), "upload-key-123456")).resolves.toEqual({ mediaId });
    expect(state.upload).not.toHaveBeenCalled();
    expect(state.calls).toHaveLength(1);
  });
  it("reconciles only its own generation when ready marking fails", async () => {
    state.readyWrite = false;
    await expect(socialGalleryStore().upload(actor, new File(["photo"], "photo.jpg"), "upload-key-123456")).rejects.toMatchObject({ code: "GALLERY_UPLOAD_UNAVAILABLE" });
    expect(state.cleanup).toHaveBeenCalledWith(actor.profileId, mediaId, generation);
  });
  it("does not replace missing durable RPCs with memory success", async () => {
    state.missing = true;
    await expect(socialGalleryStore().upload(actor, new File(["photo"], "photo.jpg"), "upload-key-123456")).rejects.toMatchObject({ code: "PGRST202" });
    expect(state.upload).not.toHaveBeenCalled();
  });
  it("submits partial edit intent and projects only public gallery metadata", async () => {
    const payload = { expectedMutationVersion: 0, gallery: [{ mediaId, altText: "Canal" }] };
    const { post, audit } = await socialGalleryStore().edit("44444444-4444-4444-8444-444444444444", actor, payload, "edit-key-123456");
    expect(state.calls[0]).toMatchObject({ name: "edit_social_post_gallery_idempotent", input: { p_actor: actor.profileId,
      p_payload: { ...payload, postId: "44444444-4444-4444-8444-444444444444" }, p_idempotency_key: "edit-key-123456" } });
    expect(state.calls[0].input.p_payload).not.toHaveProperty("visibility");
    expect(audit).toEqual({ fromMutationVersion: 0, toMutationVersion: 0 });
    expect(post.mutationVersion).toBe(1);
    expect(post.photos).toEqual([{ mediaId, altText: "Canal", kind: "photo", contentType: "image/jpeg" }]);
    expect(JSON.stringify(post)).not.toContain("objectKey");
    expect(JSON.stringify(post)).not.toContain("authorProfileId");
  });
});
