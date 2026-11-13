import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// Pal's propose_plan drafts a crawl a group may walk, so it never holds a bar
// the public cannot walk into (launch plan P0 #1). The pack is the real
// shipped London record cut to the pubs within a short walk of "The Three Tuns -
// LSE Student Union" (venue-p7p18j, Aldwych). Its listed pint is the cheapest
// there, so a cheap ask ranks it first unless the members-only rule holds.

const { pack } = vi.hoisted(() => ({ pack: { venues: [] as unknown[] } }));

vi.mock("@/lib/concierge/venues.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/concierge/venues.server")>();
  return { ...actual, loadConciergeVenues: async () => pack.venues };
});

import { runAskTool } from "@/lib/ask/tools";
import { haversineKm } from "@/lib/haversine";

const THREE_TUNS_ID = "venue-p7p18j";

describe("Pal propose_plan near a students' union bar", () => {
  it("drafts a cheap walkable crawl without the members-only bar", async () => {
    const actual = await vi.importActual<typeof import("@/lib/concierge/venues.server")>(
      "@/lib/concierge/venues.server",
    );
    const all = await actual.loadConciergeVenues("london");
    const tuns = all.find((venue) => venue.id === THREE_TUNS_ID);
    expect(tuns, "the shipped record still holds the Three Tuns").toBeDefined();
    pack.venues = all.filter((venue) => haversineKm([tuns!.lng, tuns!.lat], [venue.lng, venue.lat]) <= 0.6);

    const query = "Plan a cheap crawl for 4";
    const result = await runAskTool("propose_plan", { query }, { cityId: "london", query, skipModel: true });
    const stops = ((result.data as { stops?: { id: string; name: string }[] } | null)?.stops ?? []);
    expect(result.ok).toBe(true);
    expect(stops).toHaveLength(3);
    expect(stops.map((stop) => stop.id)).not.toContain(THREE_TUNS_ID);
    expect(result.cards.map((card) => card.venueId)).not.toContain(THREE_TUNS_ID);
    for (const proposal of result.proposals) {
      if (proposal.kind === "draft_plan") expect(proposal.stopIds).not.toContain(THREE_TUNS_ID);
      if (proposal.kind === "open_venue") expect(proposal.venueId).not.toBe(THREE_TUNS_ID);
    }
  });
});
