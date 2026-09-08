import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { inspectSocialVideo, SOCIAL_VIDEO_MAX_BYTES } from "@/lib/socialMediaPolicy";
import { prepareSocialVideo, readMemorySocialMedia, reserveSocialPhotoUpload, uploadPreparedSocialPhoto } from "@/lib/socialPostMedia.server";
import { createMemorySocialPostStore, socialPostFromRow } from "@/lib/socialPostStore";
import { parseSocialEditSubmission } from "@/lib/socialPostSubmission";

const fixture = (fast = false) => readFileSync(new URL(`./fixtures/social-video${fast ? "-faststart" : ""}.mp4`, import.meta.url));
const actor = { accountId: "account-a", profileId: "profile-a", handle: "alice" };
const other = { accountId: "account-b", profileId: "profile-b", handle: "bob" };
const file = () => new File([fixture()], "night.mp4", { type: "video/mp4" });

describe("bounded Social MP4", () => {
  it.each([false, true])("accepts a real AVC/AAC clip, with metadata and faststart=%s", (fast) => {
    expect(inspectSocialVideo(fixture(fast))).toMatchObject({ width: 320, height: 240 });
    expect(inspectSocialVideo(fixture(fast)).durationSeconds).toBeLessThan(3);
  });
  it("accepts a real 1080p portrait clip without resizing or transcoding", () => {
    const bytes = readFileSync(new URL("./fixtures/social-video-portrait.mp4", import.meta.url));
    expect(inspectSocialVideo(bytes)).toMatchObject({ width: 1080, height: 1920 });
  });
  it("rejects hostile boxes, truncation, missing tracks, false codecs and out-of-file samples", () => {
    const good = fixture();
    for (const length of [0, 7, 32, good.length - 1, Math.floor(good.length / 2)]) {
      expect(() => inspectSocialVideo(good.subarray(0, length))).toThrow();
    }
    for (const marker of ["avc1", "stco", "mdhd", "avcC"]) {
      const bytes = Buffer.from(good);
      const at = bytes.lastIndexOf(marker);
      expect(at).toBeGreaterThan(0);
      bytes.write("xxxx", at);
      expect(() => inspectSocialVideo(bytes)).toThrow();
    }
    const overflow = Buffer.from(good); overflow.writeUInt32BE(0xffffffff, 0);
    expect(() => inspectSocialVideo(overflow)).toThrow();
    const badOffset = Buffer.from(good);
    badOffset.writeUInt32BE(good.length + 20, badOffset.indexOf("stco") + 12);
    expect(() => inspectSocialVideo(badOffset)).toThrow();
    const forgedDuration = Buffer.from(good);
    forgedDuration.writeUInt32BE(16_000, forgedDuration.indexOf("mvhd") + 20);
    expect(() => inspectSocialVideo(forgedDuration)).toThrow();
  });
  it.each(["sps", "pps", "both"])("rejects zeroed %s bodies in a real playable fixture", (target) => {
    const bytes = Buffer.from(fixture());
    const config = bytes.indexOf("avcC") + 4;
    let at = config + 6;
    const corrupt = (count: number, type: string) => {
      for (let i = 0; i < count; i++) {
        const size = bytes.readUInt16BE(at); at += 2;
        if (target === type || target === "both") bytes.fill(0, at + 1, at + size);
        at += size;
      }
    };
    corrupt(bytes[config + 5] & 31, "sps");
    corrupt(bytes[at++], "pps");
    expect(() => inspectSocialVideo(bytes)).toThrow();
  });
  it("rejects forged container dimensions that disagree with the real SPS", () => {
    const bytes = Buffer.from(fixture());
    const entry = bytes.lastIndexOf("avc1") + 4;
    bytes.writeUInt16BE(1, entry + 24);
    bytes.writeUInt16BE(1, entry + 26);
    expect(() => inspectSocialVideo(bytes)).toThrow();
  });
  it("enforces MIME and byte caps before storage", async () => {
    await expect(prepareSocialVideo(new File([fixture()], "night.mp4", { type: "image/jpeg" }))).rejects.toMatchObject({ code: "INVALID_TYPE" });
    await expect(prepareSocialVideo(new File([new Uint8Array(SOCIAL_VIDEO_MAX_BYTES + 1)], "night.mp4", { type: "video/mp4" }))).rejects.toMatchObject({ code: "TOO_LARGE" });
    await expect(prepareSocialVideo(new File(["not a video"], "night.mp4", { type: "video/mp4" }))).rejects.toMatchObject({ code: "PROCESSING_FAILED" });
  });
  it("holds video for staff, never sends it to image moderation, and applies audience changes immediately", async () => {
    const prepared = await prepareSocialVideo(file());
    expect(prepared.bytes.includes(Buffer.from("+51.5074"))).toBe(false);
    expect(prepared.bytes.includes(Buffer.from("Night at the pub"))).toBe(false);
    expect(inspectSocialVideo(prepared.bytes)).toMatchObject({ width: 320, height: 240 });
    const reservation = await reserveSocialPhotoUpload(actor.profileId, prepared);
    const upload = await uploadPreparedSocialPhoto(actor.profileId, prepared, undefined, reservation.mediaId, reservation.objectKey, reservation.generation);
    expect(readMemorySocialMedia(upload.objectKey)?.bytes).toEqual(prepared.bytes);
    const store = createMemorySocialPostStore({ relationships: async () => ({ followingProfileIds: new Set([actor.profileId]), mutualProfileIds: new Set([actor.profileId]) }) });
    const fields = { kind: "standard" as const, visibility: "friends" as const, commentPolicy: "open" as const, body: "", area: null, venueId: null, hashtags: [], photo: { mediaId: upload.mediaId, altText: "Friends outside", kind: "video" as const, contentType: "video/mp4" as const } };
    const post = await store.create(actor, fields, { media: upload, idempotencyKey: "video-request-key-123", requestDigest: "digest" });
    expect((await store.create(actor, fields, { media: upload, idempotencyKey: "video-request-key-123", requestDigest: "digest" })).id).toBe(post.id);
    await expect(store.create(actor, fields, { idempotencyKey: "video-request-key-123", requestDigest: "changed" })).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    const moderate = vi.fn(async () => ({ decision: "approved" as const }));
    expect(await store.processModerationQueue({ moderate })).toMatchObject({ needsReview: 1, approved: 0 });
    expect(moderate).not.toHaveBeenCalled();
    expect(await store.mediaObjectKey!(actor, upload.mediaId)).toBeNull();
    expect(await store.moderateMedia!(post.id, upload.mediaId, 99, "approve")).toBe(false);
    expect(await store.moderateMedia!(post.id, upload.mediaId, 0, "approve")).toBe(true);
    expect(await store.mediaObjectKey!(other, upload.mediaId)).toBe(upload.objectKey);
    const edited = await store.edit(post.id, actor, 0, { visibility: "private" }, false);
    expect(await store.mediaObjectKey!(other, upload.mediaId)).toBeNull();
    expect(await store.mediaObjectKey!(actor, upload.mediaId)).toBe(upload.objectKey);
    expect(await store.remove(post.id, actor, edited.mutationVersion, "remove-video-key-1234")).toBe(true);
    expect(await store.mediaObjectKey!(actor, upload.mediaId)).toBeNull();
    expect(readMemorySocialMedia(upload.objectKey)).toBeNull();
  });
  it("preserves the discriminator from durable rows and accepts attachment-only edits", () => {
    expect(socialPostFromRow({ photo_media_id: "id", photo_alt_text: "A clip", photo_content_type: "video/mp4" }).photo).toMatchObject({ kind: "video", contentType: "video/mp4" });
    expect(parseSocialEditSubmission({ expectedMutationVersion: 0, photoAltText: "A clip" }, true).ok).toBe(true);
    expect(parseSocialEditSubmission({ expectedMutationVersion: 0, removePhoto: true }, false).ok).toBe(true);
  });
});
