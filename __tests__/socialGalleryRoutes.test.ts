import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  frozen: false,
  limited: false,
  access: vi.fn(),
  limit: vi.fn(),
  upload: vi.fn(),
  create: vi.fn(),
  edit: vi.fn(),
  legacyCreate: vi.fn(),
  legacyEdit: vi.fn(),
  venue: vi.fn(),
}));
vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));
vi.mock("@/lib/opsFreeze", () => ({ socialFreezeResponse: () => state.frozen ? Response.json({ code: "FROZEN" }, { status: 503 }) : null }));
vi.mock("@/lib/socialAccessServer", () => ({ requireVerifiedSocialActor: state.access }));
vi.mock("@/lib/pintDrops", () => ({ isLimited: state.limit }));
vi.mock("@/lib/socialGalleryStore", () => ({ socialGalleryStore: () => ({ upload: state.upload, create: state.create, edit: state.edit }) }));
vi.mock("@/lib/socialPostStore", async (original) => ({
  ...await original<typeof import("@/lib/socialPostStore")>(),
  socialPostStore: () => ({ create: state.legacyCreate, edit: state.legacyEdit }),
}));
vi.mock("@/lib/venueIndex", () => ({ lookupCanonicalVenue: state.venue }));

import { POST as upload } from "@/app/api/social/uploads/photos/route";
import { POST as create } from "@/app/api/social/posts/route";
import { PATCH } from "@/app/api/social/posts/[postId]/route";
import { SocialPostStoreError } from "@/lib/socialPostStore";
import { SocialPhotoError } from "@/lib/socialPostMedia.server";
import { hashActor } from "@/lib/supabase";
import { UPLOAD_PHOTO_MAX_BYTES, UPLOAD_FIELDS_ALLOWANCE_BYTES } from "@/lib/uploadBodyLimit";

const actor = { accountId: "account-a", profileId: "profile-a", handle: "alice" };
const postId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const mediaId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const key = "gallery-route-proof-1234";
const gallery = [{ mediaId, altText: "Our table" }];
const fields = { kind: "standard", visibility: "friends", commentPolicy: "open", body: "Together", gallery };
const post = { id: postId, mutationVersion: 3, venueId: null, venueProjected: false, venueName: null, photo: gallery[0], photos: gallery };
const headers = { Authorization: "Bearer alice", "Idempotency-Key": key };

function json(input: unknown, method = "POST", extra: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/social/posts", { method, headers: { ...headers, "Content-Type": "application/json", ...extra }, body: JSON.stringify(input) });
}
function patch(input: unknown, extra: Record<string, string> = {}): Promise<Response> {
  return PATCH(json(input, "PATCH", extra), { params: Promise.resolve({ postId }) });
}
function photoFile(size = 3, type = "image/jpeg"): File {
  return new File([new Uint8Array(size)], "photo.jpg", { type });
}
function multipart(file: File | string = photoFile(), extra?: (form: FormData) => void): Request {
  const form = new FormData();
  form.append("photo", file);
  extra?.(form);
  return new Request("http://localhost/api/social/uploads/photos", { method: "POST", headers, body: form });
}

beforeEach(() => {
  vi.clearAllMocks();
  state.frozen = false;
  state.limited = false;
  state.access.mockImplementation(async (request: Request) => request.headers.get("Authorization") === "Bearer alice"
    ? { ok: true, actor }
    : { ok: false, status: 401, code: "AUTH_REQUIRED", error: "Sign in." });
  state.limit.mockImplementation(async () => state.limited);
  state.upload.mockResolvedValue({ mediaId });
  state.create.mockResolvedValue(post);
  state.edit.mockResolvedValue(post);
  state.legacyCreate.mockResolvedValue(post);
  state.legacyEdit.mockResolvedValue(post);
  state.venue.mockResolvedValue({ status: "found", canonicalId: "pub-canonical", venue: { kind: "pub", name: "The Pub" } });
});

describe("gallery photo upload route", () => {
  it("hands one bounded photo, server actor and key to the store", async () => {
    const response = await upload(multipart());
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ upload: { mediaId } });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(state.upload).toHaveBeenCalledWith(actor, expect.any(File), key);
    expect(state.limit).toHaveBeenCalledWith(`social-gallery-upload:${hashActor(actor.profileId)}`, expect.any(String), 30, 60_000);
  });

  it("checks freeze, authentication and rate limit before consuming the body", async () => {
    state.frozen = true;
    expect((await upload(multipart())).status).toBe(503);
    expect(state.access).not.toHaveBeenCalled();
    state.frozen = false;
    const anonymous = multipart();
    anonymous.headers.delete("Authorization");
    expect((await upload(anonymous)).status).toBe(401);
    state.limited = true;
    const limited = multipart();
    expect((await upload(limited)).status).toBe(429);
    expect(limited.bodyUsed).toBe(false);
    expect(state.upload).not.toHaveBeenCalled();
  });

  it("rejects absent keys, duplicate files, extra fields, non-files, empty files and video", async () => {
    const noKey = multipart();
    noKey.headers.delete("Idempotency-Key");
    for (const request of [noKey, multipart(photoFile(), form => form.append("photo", photoFile())),
      multipart(photoFile(), form => form.set("post", "{}")), multipart("not a file"),
      multipart(photoFile(0)), multipart(photoFile(3, "video/mp4")), json({ photo: "data" })]) {
      expect((await upload(request)).status).toBe(400);
    }
    expect(state.upload).not.toHaveBeenCalled();
  });

  it("enforces both file size and actual streamed body size without trusting Content-Length", async () => {
    expect((await upload(multipart(photoFile(UPLOAD_PHOTO_MAX_BYTES)))).status).toBe(201);
    state.upload.mockClear();
    expect((await upload(multipart(photoFile(UPLOAD_PHOTO_MAX_BYTES + 1)))).status).toBe(400);
    const oversized = new Request("http://localhost/api/social/uploads/photos", {
      method: "POST", headers: { ...headers, "Content-Type": "multipart/form-data; boundary=oversized", "Content-Length": "1" },
      body: new Uint8Array(UPLOAD_PHOTO_MAX_BYTES + UPLOAD_FIELDS_ALLOWANCE_BYTES + 1),
    });
    expect((await upload(oversized)).status).toBe(413);
    expect(state.upload).not.toHaveBeenCalled();
  });

  it.each([
    [new SocialPhotoError("PROCESSING_FAILED", "Invalid bytes."), 400],
    [new SocialPhotoError("STORAGE_UNAVAILABLE", "Storage unavailable."), 503],
    [new SocialPostStoreError("GALLERY_UPLOAD_UNAVAILABLE", "Upload expired."), 409],
    [new Error("private database detail"), 503],
  ])("maps upload failures without exposing internal errors", async (error, status) => {
    state.upload.mockRejectedValueOnce(error);
    const response = await upload(multipart());
    expect(response.status).toBe(status);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.text()).not.toContain("private database detail");
  });
});

describe("gallery JSON dispatch", () => {
  it("creates with a canonical venue and projects its name", async () => {
    state.create.mockResolvedValue({ ...post, venueId: "pub-canonical", venueProjected: true });
    const response = await create(json({ ...fields, venueId: "pub-alias" }));
    expect(response.status).toBe(201);
    expect((await response.json()).post.venueName).toBe("The Pub");
    expect(state.create).toHaveBeenCalledWith(actor, expect.objectContaining({ gallery, venueId: "pub-canonical" }), key);
    expect(state.limit).toHaveBeenCalledWith(`social-post-create:${hashActor(actor.profileId)}`, expect.any(String));
    expect(state.legacyCreate).not.toHaveBeenCalled();
  });

  it("edits with version, idempotency, venue and the existing audit shape", async () => {
    const response = await patch({ expectedMutationVersion: 2, gallery, venueId: "pub-alias" });
    expect(response.status).toBe(200);
    expect((await response.json()).audit).toEqual({ fromMutationVersion: 2, toMutationVersion: 3 });
    expect(state.edit).toHaveBeenCalledWith(postId, actor, expect.objectContaining({ expectedMutationVersion: 2, gallery, venueId: "pub-canonical" }), key);
    expect(state.limit).toHaveBeenCalledWith(`social-post-edit:${hashActor(actor.profileId)}`, expect.any(String));
    expect(state.legacyEdit).not.toHaveBeenCalled();
  });

  it("permits explicit removal of every gallery photo", async () => {
    expect((await patch({ expectedMutationVersion: 2, gallery: [] })).status).toBe(200);
    expect(state.edit).toHaveBeenCalledWith(postId, actor, expect.objectContaining({ gallery: [] }), key);
  });

  it.each(["photoAltText", "tagHandles", "removePhoto", "photo", "photos"])("rejects mixed legacy field %s", async field => {
    expect((await create(json({ ...fields, [field]: "bad" }))).status).toBe(400);
    expect((await patch({ expectedMutationVersion: 2, gallery, [field]: "bad" })).status).toBe(400);
    expect(state.create).not.toHaveBeenCalled();
    expect(state.edit).not.toHaveBeenCalled();
  });

  it("rejects multipart galleries even without a file, and non-JSON media types", async () => {
    for (const method of ["POST", "PATCH"]) {
      const input = method === "POST" ? fields : { expectedMutationVersion: 2, gallery };
      const form = new FormData();
      form.set("post", JSON.stringify(input));
      const request = new Request("http://localhost/api/social/posts", { method, headers, body: form });
      const response = method === "POST" ? await create(request) : await PATCH(request, { params: Promise.resolve({ postId }) });
      expect(response.status).toBe(400);
    }
    expect((await create(json(fields, "POST", { "Content-Type": "text/plain" }))).status).toBe(400);
    expect(state.create).not.toHaveBeenCalled();
    expect(state.edit).not.toHaveBeenCalled();
  });

  it("requires edit keys, valid versions, valid IDs and bounded JSON", async () => {
    expect((await patch({ expectedMutationVersion: 2, gallery }, { "Idempotency-Key": "" })).status).toBe(400);
    expect((await patch({ gallery })).status).toBe(400);
    expect((await PATCH(json({ gallery }, "PATCH"), { params: Promise.resolve({ postId: "invalid" }) })).status).toBe(404);
    expect((await create(json({ ...fields, body: "x".repeat(65_537) }))).status).toBe(400);
    expect((await patch({ expectedMutationVersion: 2, gallery, body: "x".repeat(65_537) })).status).toBe(400);
    expect(state.create).not.toHaveBeenCalled();
    expect(state.edit).not.toHaveBeenCalled();
  });

  it("preserves freeze, actor and rate guards for both writes", async () => {
    for (const submit of [() => create(json(fields)), () => patch({ expectedMutationVersion: 2, gallery })]) {
      state.frozen = true;
      expect((await submit()).status).toBe(503);
      state.frozen = false;
      state.access.mockResolvedValueOnce({ ok: false, status: 401, code: "AUTH_REQUIRED", error: "Sign in." });
      expect((await submit()).status).toBe(401);
      state.limited = true;
      expect((await submit()).status).toBe(429);
      state.limited = false;
    }
    expect(state.create).not.toHaveBeenCalled();
    expect(state.edit).not.toHaveBeenCalled();
  });

  it.each([["unavailable", 503], ["missing", 400]])("preserves venue refusal %s", async (status, expected) => {
    state.venue.mockResolvedValue({ status });
    expect((await create(json({ ...fields, venueId: "pub-alias" }))).status).toBe(expected);
    expect((await patch({ expectedMutationVersion: 2, gallery, venueId: "pub-alias" })).status).toBe(expected);
    expect(state.create).not.toHaveBeenCalled();
    expect(state.edit).not.toHaveBeenCalled();
  });

  it.each(["EDIT_CONFLICT", "IDEMPOTENCY_CONFLICT", "GALLERY_UPLOAD_UNAVAILABLE"] as const)("maps %s to 409", async code => {
    state.create.mockRejectedValueOnce(new SocialPostStoreError(code, "Conflict."));
    state.edit.mockRejectedValueOnce(new SocialPostStoreError(code, "Conflict."));
    expect((await create(json(fields))).status).toBe(409);
    expect((await patch({ expectedMutationVersion: 2, gallery })).status).toBe(409);
  });

  it("keeps ordinary JSON on the legacy handlers", async () => {
    const { gallery: omitted, ...legacy } = fields;
    expect(omitted).toHaveLength(1);
    expect((await create(json(legacy))).status).toBe(201);
    expect((await patch({ expectedMutationVersion: 2, body: "Changed" })).status).toBe(200);
    expect(state.legacyCreate).toHaveBeenCalledOnce();
    expect(state.legacyEdit).toHaveBeenCalledOnce();
    expect(state.create).not.toHaveBeenCalled();
    expect(state.edit).not.toHaveBeenCalled();
  });
});
