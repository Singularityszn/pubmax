import { describe, expect, it, vi } from "vitest";

import { runAskTool } from "@/lib/ask/tools";
import { canonicalizeSaved } from "@/lib/savedPubs";
import { loadVenueAliasResolver } from "@/lib/venueAliases";

vi.mock("@/lib/communityPriceStore", () => ({
  readCommunityPricesWithStatus: async () => ({ prices: [], degraded: false }),
}));

describe("published Blackfriar identity", () => {
  it("keeps a Pub Pal tool card with the old id resolvable", async () => {
    const answer = await runAskTool("venue_prices", { venueId: "venue-1sw9ofl" }, {
      cityId: "london", query: "", skipModel: true,
    });
    expect(answer.ok).toBe(true);
    expect(answer.data).toMatchObject({ venueId: "venue-eltcmh", curatedPrice: 6.5 });
    expect(answer.cards.map((card) => card.venueId)).toContain("venue-eltcmh");
  });

  it("preserves saved notes and lists through the published alias", async () => {
    const aliases = await loadVenueAliasResolver();
    const saved = {
      venueId: "venue-1sw9ofl", listType: "Want to Visit", note: "Friday route",
      savedAt: "2026-10-04T12:00:00.000Z",
    };
    expect(canonicalizeSaved([
      saved,
      { ...saved, venueId: "venue-eltcmh" },
      { ...saved, listType: "My Friday pubs" },
    ], aliases.canonical)).toEqual([
      { ...saved, venueId: "venue-eltcmh" },
      { ...saved, venueId: "venue-eltcmh", listType: "My Friday pubs" },
    ]);
  });
});
