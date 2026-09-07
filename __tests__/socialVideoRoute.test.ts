import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));
vi.mock("@/lib/opsFreeze", () => ({ socialFreezeResponse: () => null }));
vi.mock("@/lib/pintDrops", () => ({ isLimited: async () => false }));
vi.mock("@/lib/socialAccessServer", () => ({
  requireVerifiedSocialActor: async (request: Request) => {
    const token = request.headers.get("authorization");
    if (token !== "Bearer alice" && token !== "Bearer bob") return { ok: false, status: 401, code: "AUTH_REQUIRED", error: "Sign in." };
    const name = token.slice(7);
    return { ok: true, actor: { accountId: `account-${name}`, profileId: `profile-${name}`, handle: name } };
  },
}));
vi.mock("@/lib/followStore", () => ({ followStore: () => ({ listFollowing: async () => [], listMutuals: async () => [] }) }));
vi.mock("@/lib/profileStore", () => ({ profileStore: () => ({ getByHandle: async (handle: string) => ({ id: `profile-${handle}`, handle }) }) }));

import { POST } from "@/app/api/social/posts/route";
import { PATCH } from "@/app/api/social/posts/[postId]/route";
import { GET } from "@/app/api/social/media/[mediaId]/route";
import { memorySocialPostStore } from "@/lib/socialPostStore";

const bytes = readFileSync(new URL("./fixtures/social-video.mp4", import.meta.url));
const key = "video-route-proof-key-1234";
function submission(fields: Record<string, unknown>, extra?: { duplicate?: boolean; hostile?: boolean }) {
  const form = new FormData();
  form.set("post", JSON.stringify(fields));
  form.set("video", new File([extra?.hostile ? new Uint8Array([1, 2, 3]) : bytes], "night.mp4", { type: "video/mp4" }));
  if (extra?.duplicate) form.set("photo", new File([bytes], "extra.jpg", { type: "image/jpeg" }));
  return form;
}
const fields = { kind: "standard", visibility: "private", commentPolicy: "open", body: "A night together", photoAltText: "Friends outside the pub" };
const create = (body: FormData) => POST(new Request("http://localhost/api/social/posts", { method: "POST", headers: { Authorization: "Bearer alice", "Idempotency-Key": key }, body }));
function media(id: string, who = "alice", headers: Record<string, string> = {}) {
  return GET(new Request(`http://localhost/api/social/media/${id}`, { headers: { Authorization: `Bearer ${who}`, ...headers } }), { params: Promise.resolve({ mediaId: id }) });
}

describe("Social video route journey with real bytes and memory persistence", () => {
  it("refuses mixed files, hostile files, video tags and anonymous uploads", async () => {
    expect((await create(submission(fields, { duplicate: true }))).status).toBe(400);
    expect((await create(submission(fields, { hostile: true }))).status).toBe(400);
    expect((await create(submission({ ...fields, tagHandles: ["bob"] }))).status).toBe(400);
    expect((await POST(new Request("http://localhost/api/social/posts", { method: "POST", body: submission(fields) }))).status).toBe(401);
  });
  it("uploads, replays, holds, authorizes playback and ranges, replaces and removes a video", async () => {
    const response = await create(submission(fields));
    expect(response.status).toBe(201);
    const { post } = await response.json();
    expect(post.photo).toMatchObject({ kind: "video", contentType: "video/mp4" });
    expect((await (await create(submission(fields))).json()).post.id).toBe(post.id);
    expect((await media(post.photo.mediaId)).status).toBe(404);
    expect(await memorySocialPostStore.processModerationQueue({ moderate: async () => { throw new Error("Video entered image moderation"); } })).toMatchObject({ needsReview: 1 });
    await memorySocialPostStore.moderateMedia!(post.id, post.photo.mediaId, 0, "approve");
    expect((await media(post.photo.mediaId, "bob")).status).toBe(404);
    expect((await media(post.photo.mediaId, "anonymous")).status).toBe(404);
    const resolved = await media(post.photo.mediaId, "alice", { Accept: "application/json" });
    expect(resolved.headers.get("cache-control")).toBe("private, no-store");
    expect(await resolved.json()).toEqual({ kind: "video", contentType: "video/mp4", url: `/api/social/media/${post.photo.mediaId}` });
    const queryResolved = await GET(new Request(`http://localhost/api/social/media/${post.photo.mediaId}?format=json`, {
      headers: { Authorization: "Bearer alice" },
    }), { params: Promise.resolve({ mediaId: post.photo.mediaId }) });
    expect(await queryResolved.json()).toEqual({ kind: "video", contentType: "video/mp4", url: `/api/social/media/${post.photo.mediaId}` });
    const complete = await media(post.photo.mediaId);
    expect(complete.status).toBe(200);
    expect(complete.headers.get("content-type")).toBe("video/mp4");
    expect((await complete.arrayBuffer()).byteLength).toBe(bytes.length);
    const part = await media(post.photo.mediaId, "alice", { Range: "bytes=0-31" });
    expect(part.status).toBe(206);
    expect((await part.arrayBuffer()).byteLength).toBe(32);
    expect((await media(post.photo.mediaId, "alice", { Range: "bytes=999999999-" })).status).toBe(416);
    const changed = await PATCH(new Request(`http://localhost/api/social/posts/${post.id}`, { method: "PATCH", headers: { Authorization: "Bearer alice" }, body: submission({ expectedMutationVersion: 0, photoAltText: "A replacement clip" }) }), { params: Promise.resolve({ postId: post.id }) });
    expect(changed.status).toBe(200);
    const replacement = (await changed.json()).post;
    expect(replacement.photo.mediaId).not.toBe(post.photo.mediaId);
    expect((await media(post.photo.mediaId)).status).toBe(404);
    expect((await media(replacement.photo.mediaId)).status).toBe(404);
    const removed = await PATCH(new Request(`http://localhost/api/social/posts/${post.id}`, { method: "PATCH", headers: { Authorization: "Bearer alice", "Content-Type": "application/json" }, body: JSON.stringify({ expectedMutationVersion: replacement.mutationVersion, removePhoto: true }) }), { params: Promise.resolve({ postId: post.id }) });
    expect(removed.status).toBe(200);
    expect((await removed.json()).post.photo).toBeNull();
  });
});
