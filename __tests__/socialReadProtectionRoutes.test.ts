import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ limited: true, mediaReads: 0, imageReads: 0, venueReads: 0 }));
vi.mock("@/lib/socialAccessServer", () => ({ requireVerifiedSocialActor: async () => ({ ok: true, actor: { profileId: "profile-a", handle: "alice", accountId: "account-a" } }) }));
vi.mock("@/lib/pintDrops", () => ({ isLimited: async () => state.limited }));
vi.mock("@/lib/supabase", () => ({ hashActor: () => "actor-hash" }));
vi.mock("@/lib/socialPostConsentStore", () => ({ socialPostConsentStore: { mediaObjectKey: async () => { state.mediaReads += 1; return "social/media/image.jpg"; } } }));
vi.mock("@/lib/uploadedImage.server", () => ({ downloadUploadedImageObject: async () => {
  state.imageReads += 1;
  return { bytes: Buffer.from([255, 216, 255]), contentType: "image/jpeg" };
} }));
vi.mock("@/lib/venueIndex", () => ({ getVenueIndex: async () => { state.venueReads += 1; return new Map(); } }));
vi.mock("@/lib/venueKindFilters", () => ({ isPubVenueKind: () => true }));

import { GET as media } from "@/app/api/social/media/[mediaId]/route";
import { GET as venues } from "@/app/api/social/venues/route";

beforeEach(() => { state.limited = true; state.mediaReads = 0; state.imageReads = 0; state.venueReads = 0; });

describe("protected Social read budgets", () => {
  it("returns an indistinguishable missing photo before authorization or download", async () => {
    const response = await media(new Request("http://localhost/api/social/media/11111111-1111-4111-8111-111111111111"), { params: Promise.resolve({ mediaId: "11111111-1111-4111-8111-111111111111" }) });
    expect(response.status).toBe(404);
    expect(state.mediaReads).toBe(0);
    expect(state.imageReads).toBe(0);
    expect(response.headers.get("Location")).toBeNull();
  });

  it("returns 429 before scanning the protected Venue index", async () => {
    const response = await venues(new Request("http://localhost/api/social/venues?q=proof"));
    expect(response.status).toBe(429);
    expect(state.venueReads).toBe(0);
  });
});
