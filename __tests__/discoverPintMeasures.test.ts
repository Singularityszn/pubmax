import { describe, expect, it } from "vitest";

import { pickDiscoverDrops } from "@/lib/discoverDrops";
import { cheapestTonight } from "@/lib/leaderboard";

describe("Discover pint-drop ingestion", () => {
  it("preserves servings and ranks only pints, including legacy pints", () => {
    const now = Date.parse("2026-09-21T19:00:00.000Z");
    const createdAt = new Date(now - 60 * 60 * 1000).toISOString();
    const drops = pickDiscoverDrops({
      drops: [
        { id: "half-drop", venueId: "half", drink: "Lager", measure: "half", priceGbp: 2.6, createdAt },
        { venueId: "pint", drink: "Lager", measure: "pint", priceGbp: 5, createdAt },
        { venueId: "legacy", drink: "Lager", priceGbp: 6, createdAt },
        { venueId: "other", drink: "Schooner", measure: "other", priceGbp: 2, createdAt },
        { venueId: "invalid", drink: "Yard", measure: "yard", priceGbp: 1, createdAt },
      ],
    });

    expect(drops[0]).toMatchObject({ id: "half-drop", drink: "Lager", measure: "half" });
    expect(drops[3]).toMatchObject({ measure: "other" });
    expect(drops[4]).toMatchObject({ measure: "other" });
    expect(cheapestTonight(drops, { now }).map((entry) => entry.venueId)).toEqual([
      "pint",
      "legacy",
    ]);
  });
});
