import { describe, expect, it } from "vitest";

import {
  canEditNightStory,
  cleanNightMomentDraft,
  hasPublicationConsent,
  type MomentConsent,
  type StoryContributor,
} from "@/lib/nightMemory";

describe("Night Memory domain policy", () => {
  it("creates Moments as private and preserves a Pint Drop as a reference", () => {
    expect(cleanNightMomentDraft({
      kind: "pint_drop",
      caption: "First round at The Harp",
      pintDropId: "4f2e351c-74b7-4f31-b7ff-334b6106c88e",
    })).toEqual({
      kind: "pint_drop",
      caption: "First round at The Harp",
      pintDropId: "4f2e351c-74b7-4f31-b7ff-334b6106c88e",
      venueId: null,
      mediaObjectKey: null,
      occurredAt: null,
      visibility: "private",
    });
  });

  it("rejects a Pint Drop Moment without a Pint Drop reference", () => {
    expect(cleanNightMomentDraft({ kind: "pint_drop", caption: "A pint" })).toBeNull();
  });

  it("allows only active hosts and editors to shape a Story", () => {
    const contributors: StoryContributor[] = [
      { storyId: "story", profileId: "host", role: "host", status: "accepted", joinedAt: "now" },
      { storyId: "story", profileId: "editor", role: "editor", status: "accepted", joinedAt: "now" },
      { storyId: "story", profileId: "guest", role: "contributor", status: "accepted", joinedAt: "now" },
    ];
    expect(canEditNightStory("host", contributors)).toBe(true);
    expect(canEditNightStory("editor", contributors)).toBe(true);
    expect(canEditNightStory("guest", contributors)).toBe(false);
  });

  it("requires the Moment owner's current approval for publication", () => {
    const consent: MomentConsent = {
      storyId: "story",
      momentId: "moment",
      ownerId: "person",
      status: "approved",
      decidedAt: "now",
    };
    expect(hasPublicationConsent("person", "moment", [consent])).toBe(true);
    expect(hasPublicationConsent("someone-else", "moment", [consent])).toBe(false);
    expect(hasPublicationConsent("person", "moment", [{ ...consent, status: "withdrawn" }])).toBe(false);
  });
});
