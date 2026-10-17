import { describe, expect, it } from "vitest";

import { createMemorySocialPostVideoStore } from "@/lib/socialPostVideoStore";
import {
  formatSocialVideoDuration,
  parseSocialVideoDuration,
  sniffSocialVideoType,
} from "@/lib/socialPostVideos";
import { parseSocialCreateSubmission } from "@/lib/socialPostSubmission";
import { rangedVideoResponse } from "@/lib/socialVideoRange";

const UPLOAD = "33333333-3333-4333-8333-333333333333";
const mp4 = new Uint8Array([0, 0, 0, 0x20, ...Buffer.from("ftypisom"), 0, 0, 2, 0]);
const mov = new Uint8Array([0, 0, 0, 0x14, ...Buffer.from("ftypqt  "), 0, 0, 0, 0]);
const webm = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3, 4]);

describe("Social video rules", () => {
  it("tells the container from its leading bytes, not its name", () => {
    expect(sniffSocialVideoType(mp4)).toBe("video/mp4");
    expect(sniffSocialVideoType(mov)).toBe("video/quicktime");
    expect(sniffSocialVideoType(webm)).toBe("video/webm");
    expect(sniffSocialVideoType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBeNull();
  });

  it("keeps a duration inside ten minutes and prints it as m:ss", () => {
    expect(parseSocialVideoDuration(42.567)).toBe(42.57);
    expect([0, -1, 601, Number.NaN, "42"].map(parseSocialVideoDuration)).toEqual([null, null, null, null, null]);
    expect(formatSocialVideoDuration(6)).toBe("0:06");
    expect(formatSocialVideoDuration(185)).toBe("3:05");
  });

  it("takes one video per post, with a caption, never beside a photo", () => {
    const base = { kind: "standard", visibility: "friends", body: "Reel night", commentPolicy: "open" };
    const parsed = parseSocialCreateSubmission({ ...base, videoUploadId: UPLOAD, videoDurationSeconds: 12 }, false);
    expect(parsed.ok && parsed.video).toEqual({ uploadId: UPLOAD, durationSeconds: 12 });
    expect(parseSocialCreateSubmission({ ...base, videoUploadId: UPLOAD, photoAltText: "x" }, true)).toMatchObject({ ok: false, code: "INVALID_VIDEO" });
    expect(parseSocialCreateSubmission({ ...base, body: "", videoUploadId: UPLOAD }, false)).toMatchObject({ ok: false, code: "INVALID_VIDEO" });
    expect(parseSocialCreateSubmission({ ...base, videoUploadId: "not-a-uuid" }, false)).toMatchObject({ ok: false, code: "INVALID_VIDEO" });
    expect(parseSocialCreateSubmission({ ...base, videoDurationSeconds: 12 }, false)).toMatchObject({ ok: false });
  });
});

describe("memory Social video store", () => {
  it("receives only the owner's bytes, binds once, and holds the video from everybody but its author", async () => {
    const store = createMemorySocialPostVideoStore();
    const alice = { profileId: "alice" };
    const bob = { profileId: "bob" };
    const ticket = await store.createUpload(alice, "video/mp4", mp4.byteLength);
    expect(ticket.uploadUrl).toBe(`/api/social/videos/uploads/${ticket.uploadId}`);
    expect(await store.receiveUpload(bob, ticket.uploadId, mp4)).toBe(false);
    expect(await store.inspectUpload(alice, ticket.uploadId)).toBeNull();
    expect(await store.receiveUpload(alice, ticket.uploadId, new Uint8Array(mp4.byteLength + 1))).toBe(false);
    expect(await store.receiveUpload(alice, ticket.uploadId, mp4)).toBe(true);
    expect((await store.inspectUpload(alice, ticket.uploadId))?.byteSize).toBe(mp4.byteLength);

    const video = await store.attach(alice, "post-1", ticket.uploadId, mp4.byteLength, 12);
    expect(video).toMatchObject({ url: "/api/social/videos/post-1", reviewState: "held", durationSeconds: 12 });
    await expect(store.attach(alice, "post-2", ticket.uploadId, 10, null)).rejects.toThrow(/expired/);

    expect((await store.forPosts(["post-1"], alice)).get("post-1")?.reviewState).toBe("held");
    expect((await store.forPosts(["post-1"], bob)).size).toBe(0);
    expect(await store.playback("post-1", bob)).toBeNull();
    expect((await store.heldQueue(10)).map((held) => held.postId)).toEqual(["post-1"]);

    expect(await store.review("post-1", "approved")).toBe(true);
    expect((await store.forPosts(["post-1"], bob)).get("post-1")?.reviewState).toBe("approved");
    expect(await store.playback("post-1", bob)).toMatchObject({ contentType: "video/mp4" });
    expect(await store.heldQueue(10)).toEqual([]);
  });

  it("caps open intents at five per person", async () => {
    const store = createMemorySocialPostVideoStore();
    for (let i = 0; i < 5; i += 1) await store.createUpload({ profileId: "carol" }, "video/webm", 10);
    await expect(store.createUpload({ profileId: "carol" }, "video/webm", 10)).rejects.toThrow(/earlier video/);
  });
});

describe("ranged video answers", () => {
  const bytes = new Uint8Array(Array.from({ length: 100 }, (_, i) => i));

  it("answers a whole file, an open range, a closed range and a suffix", async () => {
    const whole = rangedVideoResponse(bytes, "video/mp4", null);
    expect(whole.status).toBe(200);
    expect(whole.headers.get("accept-ranges")).toBe("bytes");
    const open = rangedVideoResponse(bytes, "video/mp4", "bytes=90-");
    expect(open.status).toBe(206);
    expect(open.headers.get("content-range")).toBe("bytes 90-99/100");
    const closed = rangedVideoResponse(bytes, "video/mp4", "bytes=10-19");
    expect([...new Uint8Array(await closed.arrayBuffer())]).toEqual([10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);
    const suffix = rangedVideoResponse(bytes, "video/mp4", "bytes=-5");
    expect(suffix.headers.get("content-range")).toBe("bytes 95-99/100");
  });

  it("refuses a range past the end", () => {
    const refused = rangedVideoResponse(bytes, "video/mp4", "bytes=200-300");
    expect(refused.status).toBe(416);
    expect(refused.headers.get("content-range")).toBe("bytes */100");
  });
});
