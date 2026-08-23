import { describe, expect, it } from "vitest";

import { profileCoverFromAvatar } from "@/app/admin/AdminClient";

describe("admin profile cover queue", () => {
  it("converts profile-level cover rows into whole-profile moderation rows", () => {
    expect(
      profileCoverFromAvatar({
        handle: "mirror",
        profileId: "profile-1",
        generation: "generation-1",
        moderationState: "approved",
        reportCount: 2,
        reportedAt: "2026-08-23T09:00:00.000Z",
        reportReason: "wrong backdrop",
        previewUrl: "/api/cover/profile-1/generation-1",
      }),
    ).toEqual({
      id: "profile-cover:profile-1",
      profileId: "profile-1",
      handle: "mirror",
      position: 1,
      generation: "generation-1",
      moderationState: "approved",
      reportCount: 2,
      reportedAt: "2026-08-23T09:00:00.000Z",
      reportReason: "wrong backdrop",
      previewUrl: "/api/cover/profile-1/generation-1",
      rotationOnly: false,
    });
  });
});
