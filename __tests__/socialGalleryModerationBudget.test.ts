import { describe, expect, it } from "vitest";
import { maxDuration } from "@/app/api/cron/moderate-social-posts/route";
import { SOCIAL_GALLERY_MAX_PHOTOS } from "@/lib/socialGallery";
import { SOCIAL_POST_MODERATION_TIMEOUT_MS } from "@/lib/socialPostModeration";

describe("gallery moderation runtime", () => {
  it("leaves database time after a full gallery of bounded provider calls", () => {
    expect(maxDuration * 1_000).toBeGreaterThan(SOCIAL_GALLERY_MAX_PHOTOS * SOCIAL_POST_MODERATION_TIMEOUT_MS);
  });
});
