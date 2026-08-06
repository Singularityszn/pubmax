import { describe, expect, it } from "vitest";

import {
  validateSocialPostCreate,
  validateSocialPostEdit,
} from "@/lib/socialPosts";

describe("Social post validation", () => {
  it("normalises a standard post without accepting ownership or moderation fields", () => {
    expect(validateSocialPostCreate({
      kind: "standard",
      visibility: "friends",
      body: "  Last orders in Camden  ",
      area: "camden",
      venueId: "venue-1",
      hashtags: ["#LastOrders", "camden", "lastorders"],
      commentPolicy: "friends",
    })).toEqual({
      ok: true,
      value: {
        kind: "standard",
        visibility: "friends",
        body: "Last orders in Camden",
        area: "camden",
        venueId: "venue-1",
        hashtags: ["lastorders", "camden"],
        commentPolicy: "friends",
        photo: null,
      },
    });

    expect(validateSocialPostCreate({
      kind: "standard",
      visibility: "public",
      body: "Nope",
      commentPolicy: "open",
      authorProfileId: "forged",
    })).toMatchObject({ ok: false, code: "INVALID_POST" });
  });

  it("requires body or an alt-text-labelled future photo and keeps exact venues non-public", () => {
    expect(validateSocialPostCreate({
      kind: "standard",
      visibility: "public",
      body: "",
      commentPolicy: "open",
    })).toMatchObject({ ok: false });
    expect(validateSocialPostCreate({
      kind: "standard",
      visibility: "friends",
      body: "",
      photo: { mediaId: "11111111-1111-4111-8111-111111111111", altText: "" },
      commentPolicy: "open",
    })).toMatchObject({ ok: false });
    expect(validateSocialPostCreate({
      kind: "standard",
      visibility: "public",
      body: "At the pub",
      venueId: "venue-1",
      commentPolicy: "open",
    })).toMatchObject({ ok: false, code: "EXACT_VENUE_NOT_ALLOWED" });
  });

  it("requires feature-request text and rejects unknown areas", () => {
    expect(validateSocialPostCreate({
      kind: "feature_request",
      visibility: "public",
      body: "",
      photo: {
        mediaId: "11111111-1111-4111-8111-111111111111",
        altText: "A sketch",
      },
      commentPolicy: "open",
    })).toMatchObject({ ok: false, code: "FEATURE_REQUEST_BODY_REQUIRED" });
    expect(validateSocialPostCreate({
      kind: "standard",
      visibility: "public",
      body: "Hello",
      area: "made-up-area",
      commentPolicy: "open",
    })).toMatchObject({ ok: false, code: "INVALID_AREA" });
  });

  it("marks only real content edits for moderation and rejects client revision state", () => {
    expect(validateSocialPostEdit({ visibility: "private" })).toEqual({
      ok: true,
      value: { visibility: "private" },
      contentChanged: false,
    });
    expect(validateSocialPostEdit({ body: "Changed words" })).toEqual({
      ok: true,
      value: { body: "Changed words" },
      contentChanged: true,
    });
    expect(validateSocialPostEdit({ revision: 99 })).toMatchObject({
      ok: false,
      code: "INVALID_POST",
    });
  });
});
