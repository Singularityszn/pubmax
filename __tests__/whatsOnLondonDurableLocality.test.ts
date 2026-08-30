// The London locality filter admits a coordless row only when its London
// provenance is recorded. Durable-store rows are fresh objects, not the
// bundled-parsed ones the WeakSet already holds, so the durable baseline must
// be marked London-verified or a venue-resolved recurring row without
// coordinates silently vanishes from /tonight.
import { describe, expect, it, vi } from "vitest";

import { loadWhatsOn } from "@/lib/whatsOnStore";

vi.mock("@/lib/whatsOnListings.server", () => ({
  loadServedWhatsOnListingsWithFreshness: vi.fn(async () => ({
    rows: [
      {
        id: "quiz-qo-pub-quiz-white-hart-whitechapel-thursdays",
        venueId: "venue-5cqxbo",
        placeName: "White Hart, Whitechapel",
        kind: "quiz",
        startsAt: "2026-08-27T20:00:00+01:00",
        title: "Pub quiz - Thursdays 8pm",
        source: {
          label: "Question One",
          url: "https://questionone.com/venues/pub-quiz-white-hart-whitechapel-thursdays/",
        },
        observedAt: "2026-08-27T11:07:30.691Z",
        confidence: "listed",
      },
    ],
    providerObservedAt: "2026-08-27T11:07:30.691Z",
    readStatus: "ready",
  })),
}));

describe("durable London What's-On locality", () => {
  it("keeps a venue-resolved row from the London durable store without coordinates", async () => {
    const result = await loadWhatsOn(
      { window: "tonight" },
      {
        now: Date.parse("2026-08-27T12:00:00.000Z"),
        fetchLive: async () => [],
      },
    );

    expect(result.rows).toEqual([
      expect.objectContaining({
        id: "quiz-qo-pub-quiz-white-hart-whitechapel-thursdays",
        venueId: "venue-5cqxbo",
      }),
    ]);
  });
});
