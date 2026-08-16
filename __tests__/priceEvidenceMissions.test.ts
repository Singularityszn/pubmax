import { describe, expect, it } from "vitest";

import {
  COMMUNITY_PRICE_MAX_AGE_MS,
  SUBMITTABLE_DRINK_CATEGORIES,
  type CommunityPrice,
} from "@/lib/communityPrice";
import { isMapLensDrinkCategory, type DrinkCategory } from "@/lib/drinks";
import {
  MAX_PRICE_EVIDENCE_MISSION_VENUE_IDS,
  PRICE_EVIDENCE_MISSION_REASONS,
  missionHeading,
  missionNamedCategory,
  missionReceiptFromReadback,
  parsePriceEvidenceMissionVenueIds,
  rankPriceEvidenceMission,
  toPriceEvidenceMissionDto,
  type PriceEvidenceMission,
  type VenueMissionRows,
} from "@/lib/priceEvidenceMissions";

const NOW = Date.parse("2026-08-16T18:00:00.000Z");

function row(
  venueId: string,
  drinkCategory: DrinkCategory,
  overrides: Partial<CommunityPrice> = {},
): CommunityPrice {
  return {
    venueId,
    drinkCategory,
    priceGbp: 4.2,
    submittedAt: NOW - 3_600_000,
    source: "community",
    corroborations: 1,
    ...overrides,
  };
}

function venues(entries: VenueMissionRows[]): VenueMissionRows[] {
  return entries;
}

describe("rankPriceEvidenceMission", () => {
  it("ranks a current provisional category first", () => {
    const mission = rankPriceEvidenceMission(
      venues([
        { venueId: "venue-stale", prices: [row("venue-stale", "beer", {
          submittedAt: NOW - COMMUNITY_PRICE_MAX_AGE_MS - 1,
        })] },
        { venueId: "venue-missing", prices: [] },
        { venueId: "venue-live", prices: [row("venue-live", "wine")] },
      ]),
      NOW,
    );
    expect(mission).toEqual({
      venueId: "venue-live",
      reason: "provisional",
      drinkCategory: "wine",
      observedAt: NOW - 3_600_000,
    });
  });

  it("ranks an expired category before a venue with no observations", () => {
    const mission = rankPriceEvidenceMission(
      venues([
        { venueId: "venue-missing", prices: [] },
        { venueId: "venue-stale", prices: [row("venue-stale", "coffee", {
          submittedAt: NOW - COMMUNITY_PRICE_MAX_AGE_MS - 1,
        })] },
      ]),
      NOW,
    );
    expect(mission).toEqual({
      venueId: "venue-stale",
      reason: "stale",
      drinkCategory: "coffee",
      observedAt: NOW - COMMUNITY_PRICE_MAX_AGE_MS - 1,
    });
  });

  it("ranks a venue with no community price observations last", () => {
    const mission = rankPriceEvidenceMission(
      venues([{ venueId: "venue-empty", prices: [] }]),
      NOW,
    );
    expect(mission).toEqual({
      venueId: "venue-empty",
      reason: "missing",
    });
  });

  it("keeps already-ranked venue order inside the same reason", () => {
    const mission = rankPriceEvidenceMission(
      venues([
        { venueId: "venue-second", prices: [row("venue-second", "beer")] },
        { venueId: "venue-first", prices: [row("venue-first", "beer")] },
      ]),
      NOW,
    );
    expect(mission?.venueId).toBe("venue-second");
  });

  it("names every submittable drink category for a provisional mission", () => {
    for (const drinkCategory of SUBMITTABLE_DRINK_CATEGORIES) {
      const mission = rankPriceEvidenceMission(
        venues([{ venueId: "venue-cat", prices: [row("venue-cat", drinkCategory)] }]),
        NOW,
      );
      expect(mission, drinkCategory).toMatchObject({
        reason: "provisional",
        drinkCategory,
      });
    }
  });

  it("skips a trusted in-window category and uses the next reason", () => {
    const mission = rankPriceEvidenceMission(
      venues([{
        venueId: "venue-trusted",
        prices: [row("venue-trusted", "beer", { corroborations: 2 })],
      }]),
      NOW,
    );
    expect(mission).toBeNull();
  });

  it("does not invent a mission when every venue read failed", () => {
    const mission = rankPriceEvidenceMission(
      venues([
        { venueId: "venue-a", prices: [], degraded: true },
        { venueId: "venue-b", prices: [], degraded: true },
      ]),
      NOW,
    );
    expect(mission).toBeNull();
  });

  it("still ranks a ready venue when a neighbour read failed", () => {
    const mission = rankPriceEvidenceMission(
      venues([
        { venueId: "venue-broken", prices: [], degraded: true },
        { venueId: "venue-ok", prices: [row("venue-ok", "soft-drink")] },
      ]),
      NOW,
    );
    expect(mission?.venueId).toBe("venue-ok");
  });

  it("skips dismissed missions and returns the next ranked one", () => {
    const dismissed = new Set(["venue-live\u0000provisional\u0000wine"]);
    const mission = rankPriceEvidenceMission(
      venues([
        { venueId: "venue-live", prices: [row("venue-live", "wine")] },
        { venueId: "venue-next", prices: [] },
      ]),
      NOW,
      dismissed,
    );
    expect(mission).toEqual({
      venueId: "venue-next",
      reason: "missing",
    });
  });

  it("never puts a price, handle, or coordinates on the candidate", () => {
    const mission = rankPriceEvidenceMission(
      venues([{ venueId: "venue-live", prices: [row("venue-live", "beer", {
        priceGbp: 9.99,
      })] }]),
      NOW,
    );
    expect(mission).not.toBeNull();
    expect(Object.keys(mission as PriceEvidenceMission).sort()).toEqual([
      "drinkCategory",
      "observedAt",
      "reason",
      "venueId",
    ]);
  });
});

describe("parsePriceEvidenceMissionVenueIds", () => {
  it("accepts a bounded unique list", () => {
    expect(parsePriceEvidenceMissionVenueIds([" venue-a ", "venue-b", "venue-a"]))
      .toEqual({ ok: true, venueIds: ["venue-a", "venue-b"] });
  });

  it("refuses an empty list and a list past the bound", () => {
    expect(parsePriceEvidenceMissionVenueIds([])).toEqual({ ok: false });
    const tooMany = Array.from(
      { length: MAX_PRICE_EVIDENCE_MISSION_VENUE_IDS + 1 },
      (_, index) => `venue-${index}`,
    );
    expect(parsePriceEvidenceMissionVenueIds(tooMany)).toEqual({ ok: false });
  });
});

describe("toPriceEvidenceMissionDto", () => {
  it("drops price, handle, and coordinates if a caller tries to smuggle them", () => {
    const dto = toPriceEvidenceMissionDto({
      venueId: "venue-live",
      reason: "provisional",
      drinkCategory: "beer",
      observedAt: NOW,
      priceGbp: 4.2,
      handle: "night_owl",
      lat: 51.5,
      lng: -0.1,
    } as PriceEvidenceMission & {
      priceGbp: number;
      handle: string;
      lat: number;
      lng: number;
    });
    expect(dto).toEqual({
      venueId: "venue-live",
      reason: "provisional",
      drinkCategory: "beer",
      observedAt: NOW,
    });
  });

  it("omits category and date on a missing mission", () => {
    expect(toPriceEvidenceMissionDto({
      venueId: "venue-empty",
      reason: "missing",
    })).toEqual({
      venueId: "venue-empty",
      reason: "missing",
    });
  });
});

describe("missionReceiptFromReadback", () => {
  it("says the price is trusted only when the read-back is corroborated and in window", () => {
    const receipt = missionReceiptFromReadback({
      price: row("venue-live", "beer", { corroborations: 2 }),
      now: NOW,
    });
    expect(receipt).toEqual({
      outcome: "trusted",
      line: "Price is trusted now.",
    });
  });

  it("asks for another independent check when the logged price is still alone", () => {
    const receipt = missionReceiptFromReadback({
      price: row("venue-live", "beer"),
      now: NOW,
    });
    expect(receipt).toEqual({
      outcome: "needs_check",
      line: "Another independent check is still needed.",
    });
  });

  it("does not claim map impact for a category the map will not paint", () => {
    const other = row("venue-live", "other", { corroborations: 2 });
    expect(isMapLensDrinkCategory("other")).toBe(false);
    expect(missionReceiptFromReadback({ price: other, now: NOW })).toEqual({
      outcome: "logged",
      line: "Logged.",
    });
  });

  it("never infers trust from the client mission reason", () => {
    const uncorroborated = row("venue-live", "beer", { corroborations: 1 });
    const corroborated = row("venue-live", "beer", { corroborations: 2 });
    expect(missionReceiptFromReadback({ price: uncorroborated, now: NOW }).outcome)
      .toBe("needs_check");
    expect(missionReceiptFromReadback({ price: corroborated, now: NOW }).outcome)
      .toBe("trusted");
  });
});

describe("missionHeading", () => {
  it("names the drink a provisional or stale mission is about", () => {
    expect(
      missionHeading({ reason: "provisional", venueName: "The Crown", drinkCategory: "wine" }),
    ).toBe("Check the wine price at The Crown");
    expect(
      missionHeading({ reason: "stale", venueName: "The Crown", drinkCategory: "soft-drink" }),
    ).toBe("The soft drink price at The Crown is out of date");
  });

  it("never prints the catch-all category as a drink noun", () => {
    expect(
      missionHeading({ reason: "provisional", venueName: "The Crown", drinkCategory: "other" }),
    ).toBe("Check the price at The Crown");
    expect(
      missionHeading({ reason: "stale", venueName: "The Crown", drinkCategory: "other" }),
    ).toBe("The price at The Crown is out of date");
  });

  it("asks for any price when nothing is logged", () => {
    expect(
      missionHeading({ reason: "missing", venueName: "The Crown" }),
    ).toBe("Log a price at The Crown");
  });

  it("prints a heading for every submittable category", () => {
    for (const category of SUBMITTABLE_DRINK_CATEGORIES) {
      const heading = missionHeading({
        reason: "provisional",
        venueName: "The Crown",
        drinkCategory: category,
      });
      expect(heading.startsWith("Check the ")).toBe(true);
      expect(heading.endsWith("price at The Crown")).toBe(true);
    }
  });
});

describe("missionNamedCategory", () => {
  it("names the locked drink for a provisional or stale mission", () => {
    expect(missionNamedCategory({ reason: "provisional", drinkCategory: "wine" })).toBe("wine");
    expect(missionNamedCategory({ reason: "stale", drinkCategory: "other" })).toBe("other");
  });

  it("leaves the choice open when nothing is logged", () => {
    expect(missionNamedCategory({ reason: "missing", drinkCategory: "wine" })).toBeNull();
    expect(missionNamedCategory({ reason: "provisional" })).toBeNull();
  });
});

describe("PRICE_EVIDENCE_MISSION_REASONS", () => {
  it("is the closed three-reason set", () => {
    expect(PRICE_EVIDENCE_MISSION_REASONS).toEqual([
      "provisional",
      "stale",
      "missing",
    ]);
  });
});
