import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  reads: 0, imageReads: 0, authorized: true, readError: false,
  image: "present" as "present" | "missing" | "error",
}));
vi.mock("@/lib/socialAccessServer", () => ({
  requireVerifiedSocialActor: async () => ({
    ok: true,
    actor: { accountId: "account-a", profileId: "profile-a", handle: "alice" },
  }),
}));
vi.mock("@/lib/pintDrops", () => ({ isLimited: async () => false }));
vi.mock("@/lib/supabase", () => ({ hashActor: () => "actor-digest" }));
vi.mock("@/lib/socialPostConsentStore", () => ({
  socialPostConsentStore: {
    mediaObjectKey: async () => {
      state.reads += 1;
      if (state.readError) throw new Error("Consent unavailable");
      return state.authorized ? "social/media/image.jpg" : null;
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

import { GET } from "@/app/api/social/media/[mediaId]/route";

beforeEach(() => {
  state.reads = 0;
  state.imageReads = 0;
  state.authorized = true;
  state.readError = false;
  state.image = "present";
});

function serve(): Promise<Response> {
  const mediaId = "11111111-1111-4111-8111-111111111111";
  return GET(new Request(`http://localhost/api/social/media/${mediaId}`), {
    params: Promise.resolve({ mediaId }),
  });
}

describe("Social photo delivery route", () => {
  it("rejects UUID-shaped punctuation before consent storage", async () => {
    const response = await GET(new Request("http://localhost/api/social/media/bad"), {
      params: Promise.resolve({ mediaId: "-".repeat(36) }),
    });
    expect(response.status).toBe(404);
    expect(state.reads).toBe(0);
    expect(state.imageReads).toBe(0);
  });

  it("returns authorized bytes without a reusable redirect", async () => {
    const response = await serve();
    expect(response.status).toBe(200);
    expect(response.headers.get("Location")).toBeNull();
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("Content-Type")).toBe("image/jpeg");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([255, 216, 255]));
  });

  it("checks current permission before each delivery", async () => {
    expect((await serve()).status).toBe(200);
    state.authorized = false;
    expect((await serve()).status).toBe(404);
    expect(state.reads).toBe(2);
    expect(state.imageReads).toBe(1);
  });

  it("refuses consent-store errors before downloading", async () => {
    state.readError = true;
    expect((await serve()).status).toBe(404);
    expect(state.imageReads).toBe(0);
  });

  it.each(["missing", "error"] as const)("keeps the missing-photo envelope when Storage is %s", async (image) => {
    state.image = image;
    const response = await serve();
    expect(response.status).toBe(404);
    expect(response.headers.get("Location")).toBeNull();
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.json()).toMatchObject({ code: "NOT_FOUND" });
  });
});
