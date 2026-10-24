import { describe, expect, it } from "vitest";

import { tonightPubListingCount } from "@/lib/tonightOutListings";
import type { WhatsOnRow } from "@/lib/whatsOn";

const NOW = Date.parse("2026-10-24T12:00:00.000Z");

function listing(id: string, changes: Partial<WhatsOnRow> = {}): WhatsOnRow {
  return {
    id,
    venueId: "venue-test-arms",
    placeName: "The Test Arms",
    kind: "quiz",
    title: "Saturday quiz",
    startsAt: "2026-10-24T19:00:00.000Z",
    observedAt: "2026-10-24T08:00:00.000Z",
    source: { label: "The Test Arms", url: "https://example.com/quiz" },
    confidence: "listed",
    ...changes,
  };
}

describe("Tonight pub listing count", () => {
  it("counts only fresh, pub-matched listings that have not ended", () => {
    expect(tonightPubListingCount([
      listing("fresh"),
      listing("theatre", { venueId: undefined, placeName: "Theatre", kind: "event" }),
      listing("stale", { observedAt: "2026-10-07T08:00:00.000Z" }),
      listing("undated", { observedAt: "" }),
      listing("ended", { startsAt: "2026-10-24T05:00:00.000Z", endsAt: "2026-10-24T06:00:00.000Z" }),
    ], NOW)).toBe(1);
  });
});
