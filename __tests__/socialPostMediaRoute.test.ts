import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ reads: 0, imageReads: 0, authorized: true }));
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
      return state.authorized ? "social/media/image.jpg" : null;
    },
  },
}));
vi.mock("@/lib/uploadedImage.server", () => ({
  downloadUploadedImageObject: async () => {
    state.imageReads += 1;
    return { bytes: Buffer.from([255, 216, 255]), contentType: "image/jpeg" };
  },
}));

import { GET } from "@/app/api/social/media/[mediaId]/route";

describe("Social photo delivery route", () => {
  it("rejects UUID-shaped punctuation before consent storage", async () => {
    state.reads = 0;
    const response = await GET(new Request("http://localhost/api/social/media/bad"), {
      params: Promise.resolve({ mediaId: "-".repeat(36) }),
    });
    expect(response.status).toBe(404);
    expect(state.reads).toBe(0);
  });

  it("streams private bytes instead of returning a reusable signed URL", async () => {
    state.reads = 0;
    state.imageReads = 0;
    state.authorized = true;
    const response = await GET(new Request("http://localhost/api/social/media/11111111-1111-4111-8111-111111111111"), {
      params: Promise.resolve({ mediaId: "11111111-1111-4111-8111-111111111111" }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("Location")).toBeNull();
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("Content-Type")).toContain("image/jpeg");
    expect(state.reads).toBe(1);
    expect(state.imageReads).toBe(1);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(
      new Uint8Array([255, 216, 255]),
    );
  });

  it("rechecks current relationship before each delivery", async () => {
    state.reads = 0;
    state.imageReads = 0;
    state.authorized = true;
    const first = await GET(new Request("http://localhost/api/social/media/11111111-1111-4111-8111-111111111111"), {
      params: Promise.resolve({ mediaId: "11111111-1111-4111-8111-111111111111" }),
    });
    expect(first.status).toBe(200);

    state.authorized = false;
    const afterBlock = await GET(new Request("http://localhost/api/social/media/11111111-1111-4111-8111-111111111111"), {
      params: Promise.resolve({ mediaId: "11111111-1111-4111-8111-111111111111" }),
    });
    expect(afterBlock.status).toBe(404);
    expect(state.reads).toBe(2);
    expect(state.imageReads).toBe(1);
  });
});
