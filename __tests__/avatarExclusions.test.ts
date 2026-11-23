import { describe, expect, it } from "vitest";

import { redactFamilyTableEntries } from "@/lib/ledger";
import type { NightStory } from "@/lib/nightMemory";
import { safeNightStory } from "@/lib/nightMemoryStore";
import { buildSpillPreview } from "@/lib/spillPreview";
import { defined } from "@/__tests__/helpers/defined";

// The surfaces that stay avatar-free may not import the avatar component or
// resolver, name a served avatar URL or carry an `avatarUrl`: ESLint
// `avatar-exclusion/*` (lib/avatarExclusionLint.mjs). These are the data paths.

describe("avatar WP3 exclusions (PRD anti-goals)", () => {
  it("ledger redaction surfaces never expose served avatars", () => {
    const redacted = redactFamilyTableEntries([
      {
        id: "drop-1",
        createdAt: "2024-01-01T00:00:00.000Z",
        dateLabel: "1 January 2024",
        handle: "secretpub",
        headline: "A pint",
        note: "quiet corner",
        priceLabel: "£4.50",
        era: "2024",
        provenance: "contributor",
      },
    ]);
    expect(defined(redacted[0]).handle).toBe("S.");
    expect(redacted[0]).not.toHaveProperty("avatarUrl");
  });

  it("anonymous spills keep initials only, never a served avatar URL", () => {
    const preview = buildSpillPreview({
      handle: "hush",
      visibility: "anonymous",
      price: "5.50",
      note: "",
      withWho: "",
      drink: "pint",
      era: "",
      venueName: "The Lamb",
      hasPhoto: false,
    });
    expect(preview.shownHandle).toBe("a PUBMAXXER");
    expect(preview).not.toHaveProperty("avatarUrl");
    expect(preview.initial.length).toBe(1);
  });

  it("the night-story projection carries no avatar and no private identifier", () => {
    const story = {
      id: "story-1",
      memoryId: "memory-private",
      hostEditorId: "account-private",
      title: "Thursday",
      summary: "Three pubs",
      status: "published",
      visibility: "public",
      legacyCrawlStoryId: null,
      publishedMomentIds: ["moment-1"],
      publishedAt: "2026-10-01T22:00:00.000Z",
      createdAt: "2026-10-01T21:00:00.000Z",
      updatedAt: "2026-10-01T22:00:00.000Z",
      avatarUrl: "/api/avatar/host",
    } as NightStory;
    const projected = safeNightStory(story);
    expect(projected).not.toHaveProperty("avatarUrl");
    expect(projected).not.toHaveProperty("memoryId");
    expect(projected).not.toHaveProperty("hostEditorId");
    expect(projected).toMatchObject({ id: "story-1", title: "Thursday", publishedMomentIds: ["moment-1"] });
  });
});
