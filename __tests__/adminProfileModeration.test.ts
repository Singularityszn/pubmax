import { describe, expect, it } from "vitest";

import {
  moderatorReportCount,
  profileCoverFromAvatar,
  readQueueResponse,
} from "@/app/admin/AdminClient";

describe("admin profile cover queue", () => {
  it("shows one report for an anonymous-only Pint Drop", () => {
    expect(moderatorReportCount(0)).toBe(1);
  });
  it("closes non-ok queue responses instead of leaving their body open", async () => {
    const response = new Response("temporary failure", { status: 503 });

    expect(await readQueueResponse(response)).toEqual({});
    expect(response.bodyUsed).toBe(true);
  });

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
