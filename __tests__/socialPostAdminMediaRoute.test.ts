import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  objectKey: "social/media-id/generation/image.jpg" as string | null,
  reads: 0,
  imageReads: 0,
  limited: false,
  staffConfigured: true,
  readError: false,
  image: "present" as "present" | "missing" | "error",
}));

vi.mock("@/lib/adminAuth", () => ({
  isModerator: (request: Request) => request.headers.get("x-admin-token") === "admin-token",
  moderatorStaffRoleId: (request: Request) =>
    request.headers.get("x-admin-token") === "admin-token" && state.staffConfigured
      ? "99999999-9999-4999-8999-999999999999"
      : null,
}));
vi.mock("@/lib/pintDrops", () => ({ isLimited: async () => state.limited }));
vi.mock("@/lib/supabase", () => ({
  clientIp: () => "127.0.0.1",
  hashIp: () => "ip-digest",
}));
vi.mock("@/lib/socialPostConsentStore", () => ({
  socialPostConsentStore: {
    adminMediaObjectKey: async () => {
      state.reads += 1;
      if (state.readError) throw new Error("Staff unavailable");
      return state.objectKey;
    },
  },
}));
vi.mock("@/lib/uploadedImage.server", () => ({
  downloadUploadedImageObject: async () => {
    state.imageReads += 1;
    if (state.image === "error") throw new Error("Storage unavailable");
    return state.image === "missing" ? null : { bytes: Buffer.from([255, 216, 255]), contentType: "image/jpeg" };
  },
}));

import { GET } from "@/app/api/admin/social-posts/media/[mediaId]/route";

const mediaId = "11111111-1111-4111-8111-111111111111";

function request(headers?: HeadersInit): Request {
  return new Request(`http://localhost/api/admin/social-posts/media/${mediaId}`, { headers });
}

beforeEach(() => {
  vi.stubEnv("PUBMAX_SOCIAL_FRIENDS_LAUNCH", "1");
  state.objectKey = "social/media-id/generation/image.jpg";
  state.reads = 0;
  state.imageReads = 0;
  state.limited = false;
  state.staffConfigured = true;
  state.readError = false;
  state.image = "present";
});
afterEach(() => vi.unstubAllEnvs());

describe("admin Social photo preview", () => {
  it("blocks photo reads during rollback", async () => {
    vi.stubEnv("PUBMAX_SOCIAL_FRIENDS_LAUNCH", "0");
    state.reads = 0;

    const response = await GET(request({ "x-admin-token": "admin-token" }), {
      params: Promise.resolve({ mediaId }),
    });

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "SOCIAL_PREVIEW" });
    expect(state.reads).toBe(0);
    expect(state.imageReads).toBe(0);
  });

  it("requires moderator access before reading media", async () => {
    state.reads = 0;
    const response = await GET(request(), { params: Promise.resolve({ mediaId }) });
    expect(response.status).toBe(403);
    expect(state.reads).toBe(0);
    expect(state.imageReads).toBe(0);
  });

  it("serves held post bytes without a reusable moderator URL", async () => {
    state.objectKey = "social/media-id/generation/image.jpg";
    const response = await GET(request({ "x-admin-token": "admin-token" }), {
      params: Promise.resolve({ mediaId }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("Content-Type")).toBe("image/jpeg");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([255, 216, 255]));
  });

  it("does not expose media outside the held queue", async () => {
    state.objectKey = null;
    const response = await GET(request({ "x-admin-token": "admin-token" }), {
      params: Promise.resolve({ mediaId }),
    });
    expect(response.status).toBe(404);
    expect(state.imageReads).toBe(0);
  });

  it("refuses an unconfigured staff role before reading media", async () => {
    state.staffConfigured = false;
    const response = await GET(request({ "x-admin-token": "admin-token" }), { params: Promise.resolve({ mediaId }) });
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "UNAVAILABLE", retryable: true });
    expect(state.reads).toBe(0);
    expect(state.imageReads).toBe(0);
  });

  it("keeps the read limit ahead of queue and Storage reads", async () => {
    state.limited = true;
    const response = await GET(request({ "x-admin-token": "admin-token" }), { params: Promise.resolve({ mediaId }) });
    expect(response.status).toBe(404);
    expect(state.reads).toBe(0);
    expect(state.imageReads).toBe(0);
  });

  it("rejects malformed media ids before queue and Storage reads", async () => {
    const response = await GET(request({ "x-admin-token": "admin-token" }), { params: Promise.resolve({ mediaId: "-".repeat(36) }) });
    expect(response.status).toBe(404);
    expect(state.reads).toBe(0);
    expect(state.imageReads).toBe(0);
  });

  it("keeps staff-store errors private and retryable", async () => {
    state.readError = true;
    const response = await GET(request({ "x-admin-token": "admin-token" }), { params: Promise.resolve({ mediaId }) });
    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.json()).toMatchObject({ code: "UNAVAILABLE", retryable: true });
    expect(state.imageReads).toBe(0);
  });

  it.each(["missing", "error"] as const)("preserves the Storage %s refusal", async (image) => {
    state.image = image;
    const response = await GET(request({ "x-admin-token": "admin-token" }), { params: Promise.resolve({ mediaId }) });
    expect(response.status).toBe(image === "missing" ? 404 : 503);
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });
});
