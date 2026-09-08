import { describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { createMemorySocialGalleryStore } from "@/lib/socialGalleryStore";
import type { SupabaseClient } from "@supabase/supabase-js";
vi.mock("server-only", () => ({}));
import { readSocialMediaForExport, readSocialPostsForExport } from "@/lib/socialAccountExport.server";
import { createMemorySocialPostStore } from "@/lib/socialPostStore";
import { boundedLane } from "@/lib/accountExport";

type Row = Record<string, unknown>;
function database(tables: Record<string, Row[]>, failed?: string, wrongOwner = false) {
  const calls: Array<{ table: string; column: string; owner: string; start: number; end: number }> = [];
  const client = { from(table: string) {
    let column = "", owner = "";
    const query = {
      select() { return query; },
      eq(key: string, value: string) { column = key; owner = value; return query; },
      order() { return query; },
      async range(start: number, end: number) {
        calls.push({ table, column, owner, start, end });
        if (failed === table) return { data: null, error: { message: "schema unavailable" } };
        const rows = (tables[table] ?? []).filter(item => wrongOwner || item[column] === owner);
        return { data: rows.slice(start, Math.min(end + 1, start + 1000)), error: null };
      },
    };
    return query;
  } } as unknown as SupabaseClient;
  return { client, calls };
}
const owner = "owner";
function post(id: string, extra: Row = {}): Row {
  return { id, author_profile_id: owner, author_handle: "owner", kind: "standard", status: "hidden", visibility: "private",
    body: "My night", hashtags: [], gallery_photos: null, social_post_gallery: [], legacy_media: null,
    created_at: "2026-09-08T12:00:00Z", updated_at: "2026-09-08T12:00:00Z", ...extra };
}
function media(id: string, extra: Row = {}): Row {
  return { id, owner_profile_id: owner, object_key: `social/${id}/image.jpg`, content_type: "image/jpeg",
    width: 100, height: 100, byte_size: 123, attachment_state: "detached", created_at: "2026-09-08T12:00:00Z",
    cleanup_token: "secret", ...extra };
}

describe("Social account export", () => {
  it("exports memory uploads before attachment and only for their owner", async () => {
    const posts = createMemorySocialPostStore();
    const store = createMemorySocialGalleryStore(posts);
    const actor = { profileId: owner, accountId: "user", handle: "owner" };
    const bytes = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#123456" } }).jpeg().toBuffer();
    const file = new File([new Uint8Array(bytes)], "photo.jpg", { type: "image/jpeg" });
    const upload = await store.upload(actor, file, "upload-export-proof");
    await store.upload({ ...actor, profileId: "other" }, file, "upload-other-proof");
    const before = await store.exportMedia!(owner);
    expect(before).toHaveLength(1);
    expect(before[0]).toMatchObject({ mediaId: upload.mediaId, state: "staged" });
    await store.create(actor, { kind: "standard", visibility: "private", body: "Mine", area: null,
      venueId: null, hashtags: [], commentPolicy: "open", gallery: [{ ...upload, altText: "Our table" }] }, "create-export-proof");
    const after = await store.exportMedia!(owner);
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ mediaId: upload.mediaId, state: "active" });
  });

  it("reads all retained own posts, preserving gallery order without the legacy mirror", async () => {
    const gallery = [2, 1].map(position => ({ media_id: `00000000-0000-4000-8000-00000000000${position}`, position, alt_text: `Photo ${position}`,
      media: { owner_profile_id: owner, content_type: "image/jpeg" } }));
    const db = database({ social_posts: [post("gallery", { gallery_photos: [{}, {}], social_post_gallery: gallery,
      photo_media_id: "00000000-0000-4000-8000-000000000001", photo_alt_text: "Photo 1", legacy_media: { owner_profile_id: owner, content_type: "image/jpeg" } }),
      post("removed", { status: "removed" }), post("pending", { status: "visible", moderation_state: "pending" }),
      post("foreign", { author_profile_id: "other" })] });
    const items = await readSocialPostsForExport(owner, db.client);
    expect(items.map(item => item.id)).toEqual(["gallery", "removed", "pending"]);
    expect(items[0].photos.map(item => item.mediaId)).toEqual(["00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002"]);
    expect(items[0].visibility).toBe("private");
    expect(items[0].status).toBe("hidden");
    expect(items[0]).not.toHaveProperty("author_profile_id");
    expect(db.calls.every(call => call.column === "author_profile_id" && call.owner === owner)).toBe(true);
  });

  it("keeps legacy video and distinguishes an empty gallery from a legacy photo", async () => {
    const base = { photo_media_id: "v1", photo_alt_text: "A clip", legacy_media: { owner_profile_id: owner, content_type: "video/mp4" } };
    const db = database({ social_posts: [post("video", base), post("empty", { ...base, gallery_photos: [] })] });
    const items = await readSocialPostsForExport(owner, db.client);
    expect(items[0].photos).toEqual([{ mediaId: "v1", altText: "A clip", contentType: "video/mp4" }]);
    expect(items[1].photos).toEqual([]);
  });

  it("exports detached, purging, staged and cleanup media, including expired unattached uploads", async () => {
    const db = database({ social_post_media: [media("detached"), media("purging", { attachment_state: "purging" }), media("foreign", { owner_profile_id: "other" })],
      social_post_media_uploads: [media("unused", { media_id: "unused", state: "staged", uploaded_at: "2020-01-01T00:00:00Z" }),
        media("cleanup", { media_id: "cleanup", state: "cleanup", content_type: "video/mp4" })] });
    const items = await readSocialMediaForExport(owner, db.client);
    expect(items.map(item => item.state).sort()).toEqual(["cleanup", "detached", "purging", "staged"]);
    expect(items.find(item => item.mediaId === "cleanup")?.contentType).toBe("video/mp4");
    expect(JSON.stringify(items)).not.toContain("secret");
    expect(db.calls.every(call => call.column === "owner_profile_id" && call.owner === owner)).toBe(true);
  });

  it("uses bounded pages to detect truncation when the server caps each response at 1000", async () => {
    const db = database({ social_posts: Array.from({ length: 1100 }, (_, index) => post(String(index))) });
    const result = boundedLane(await readSocialPostsForExport(owner, db.client));
    expect(result.items).toHaveLength(1000);
    expect(result.truncated).toBe(true);
    expect(db.calls.map(call => [call.start, call.end])).toEqual([[0, 499], [500, 999], [1000, 1000]]);
  });

  it("caps the combined media lane without losing the truncation signal", async () => {
    const db = database({ social_post_media: Array.from({ length: 700 }, (_, i) => media(`m${i}`)),
      social_post_media_uploads: Array.from({ length: 700 }, (_, i) => media(`u${i}`, { media_id: `u${i}`, state: "staged" })) });
    const result = boundedLane(await readSocialMediaForExport(owner, db.client));
    expect(result.items).toHaveLength(1000);
    expect(result.truncated).toBe(true);
    expect(db.calls.every(call => call.column === "owner_profile_id" && call.owner === owner)).toBe(true);
  });

  it("refuses owner mismatches and failed enrichment instead of returning an empty success", async () => {
    const wrong = database({ social_posts: [post("foreign", { author_profile_id: "other" })] }, undefined, true);
    await expect(readSocialPostsForExport(owner, wrong.client)).rejects.toThrow("owner mismatch");
    const foreignGallery = database({ social_posts: [post("p", { gallery_photos: [{}], social_post_gallery: [
      { media_id: "foreign", position: 1, alt_text: "Photo", media: { owner_profile_id: "other" } },
    ] })] });
    await expect(readSocialPostsForExport(owner, foreignGallery.client)).rejects.toThrow();
    const foreignMedia = database({ social_post_media: [media("foreign", { owner_profile_id: "other" })] }, undefined, true);
    await expect(readSocialMediaForExport(owner, foreignMedia.client)).rejects.toThrow("owner mismatch");
    const missing = database({}, "social_post_media_uploads");
    await expect(readSocialMediaForExport(owner, missing.client)).rejects.toThrow("unavailable");
    const partial = database({ social_posts: [post("p", { gallery_photos: [{}] })] });
    await expect(readSocialPostsForExport(owner, partial.client)).rejects.toThrow("incomplete");
  });

  it("exports retained memory posts by owner without applying feed visibility", async () => {
    const store = createMemorySocialPostStore();
    const actor = { profileId: owner, handle: "owner", accountId: "user" };
    const fields = { kind: "standard" as const, visibility: "private" as const, body: "My night", area: null,
      venueId: null, hashtags: [], commentPolicy: "open" as const, photo: null };
    const created = await store.create(actor, fields);
    await store.create({ ...actor, profileId: "other" }, fields);
    await store.remove(created.id, actor, created.mutationVersion, "remove-request-key");
    const items = await store.exportPosts!(owner);
    expect(items).toHaveLength(1);
    expect(items[0].status).toBe("removed");
    expect(items[0].body).toBe("My night");
  });
});
