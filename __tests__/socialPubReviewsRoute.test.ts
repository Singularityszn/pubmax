import { describe, expect, it, vi } from "vitest";

import { lotVenueAverage, type SocialLotVenueReview } from "@/lib/socialPostReviews";

const review = (authorHandle: string, rating: number, createdAt: string): SocialLotVenueReview => ({
  postId: `${authorHandle}-${createdAt}`,
  authorHandle,
  rating,
  body: "",
  photo: null,
  createdAt,
});

describe("your lot's average for one pub", () => {
  it("counts each friend once, at their newest score", () => {
    expect(lotVenueAverage([
      review("maya", 2, "2026-09-01T00:00:00Z"),
      review("maya", 4.5, "2026-10-01T00:00:00Z"),
      review("jules", 4, "2026-10-02T00:00:00Z"),
    ])).toEqual({ average: 4.3, raters: 2 });
  });

  it("answers nothing when nobody scored it", () => {
    expect(lotVenueAverage([])).toBeNull();
  });
});

const routeState = vi.hoisted(() => ({ access: { ok: true, actor: { accountId: "a", profileId: "me", handle: "me" } } as unknown }));
vi.mock("@/lib/socialAccessServer", () => ({ requireVerifiedSocialActor: async () => routeState.access }));
vi.mock("@/lib/pintDrops", () => ({ isLimited: async () => false }));
vi.mock("@/lib/venueIndex", () => ({
  lookupCanonicalVenue: async (id: string) => id === "nowhere"
    ? { status: "missing" }
    : { status: "found", canonicalId: id, venue: { id, name: `Pub ${id}`, kind: "pub" } },
}));

describe("/api/social/pub-reviews", () => {
  it("answers the reader privately, refuses a missing pub, and refuses a reader without Social", async () => {
    const { GET } = await import("@/app/api/social/pub-reviews/route");
    const ok = await GET(new Request("http://localhost/api/social/pub-reviews?venueId=venue-harp"));
    expect(ok.status).toBe(200);
    expect(ok.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await ok.json()).toEqual({ reviews: [], summary: null });

    expect((await GET(new Request("http://localhost/api/social/pub-reviews?venueId=nowhere"))).status).toBe(400);
    expect((await GET(new Request("http://localhost/api/social/pub-reviews"))).status).toBe(400);

    routeState.access = { ok: false, error: "Sign in to use Social.", code: "SOCIAL_SIGN_IN_REQUIRED", status: 401 };
    expect((await GET(new Request("http://localhost/api/social/pub-reviews?venueId=venue-harp"))).status).toBe(401);
  });
});
