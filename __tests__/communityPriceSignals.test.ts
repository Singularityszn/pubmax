import { describe, expect, it } from "vitest";

import {
  mergeCommunityPriceSignals,
  type PricedVenueSignal,
} from "@/components/map/communityPriceSignals";
import {
  freshestCommunityPrice,
  freshestPintPrice,
  replacePrice,
  upsertPrice,
} from "@/components/map/useCommunityPrices";
import {
  COMMUNITY_PRICE_MAX_AGE_MS,
  communityTrustNote,
  type CommunityPrice,
} from "@/lib/communityPrice";
import type { DrinkCategory } from "@/lib/drinks";

// The one seam that restamps the map. PubMap hands the merged map to the pins,
// the venue list, the route panel and the sheet, so what this function decides
// is what every surface shows. Pin the things that must never slip:
//
//   • freshest-wins (never backwards)
//   • "a logged price is not a Pint Drop"
//   • "only beer restamps a pin" - pin colours are pint buckets, so a cocktail
//     price must stay on the sheet and never recolour the map
//   • THE TRUST GATE: a lone anonymous report, and an aged-out one, must not
//     reach a pin at all - while still rendering on the pub's own sheet.

const NOW = Date.UTC(2026, 6, 26, 20, 0, 0);
const MINUTE = 60_000;
const DAY = 86_400_000;

/**
 * A community price. Defaults to CORROBORATED and fresh, because most cases
 * here are about the pre-existing merge rules and would otherwise be testing
 * the trust gate by accident; the gate has its own describe block below.
 */
function price(
  venueId: string,
  priceGbp: number,
  submittedAt: number,
  drinkCategory: DrinkCategory = "beer",
  corroborations = 2,
): CommunityPrice {
  return { venueId, drinkCategory, priceGbp, submittedAt, source: "community", corroborations };
}

function signals(
  entries: Array<[string, PricedVenueSignal]>,
): Map<string, PricedVenueSignal> {
  return new Map(entries);
}

function merge(
  input: Map<string, PricedVenueSignal>,
  prices: Array<[string, CommunityPrice]>,
  now: number = NOW,
) {
  return mergeCommunityPriceSignals(input, new Map(prices), now);
}

describe("mergeCommunityPriceSignals", () => {
  it("returns the input untouched when there is nothing to merge", () => {
    const input = signals([["v1", { hasPintDrops: true, latestContributorPrice: 5 }]]);
    expect(merge(input, [])).toBe(input);
  });

  it("restamps a venue with the submitted price without mutating the input", () => {
    const input = signals([["v1", { hasPintDrops: false, latestContributorPrice: null }]]);
    const merged = merge(input, [["v1", price("v1", 4.2, NOW - MINUTE)]]);

    expect(merged.get("v1")?.latestContributorPrice).toBe(4.2);
    expect(merged.get("v1")?.latestContributorAt).toBe(NOW - MINUTE);
    // Pure: the caller's map is the one React compares against next render.
    expect(input.get("v1")?.latestContributorPrice).toBeNull();
  });

  it("adds a signal for a venue that had none", () => {
    const merged = merge(signals([]), [["v9", price("v9", 6.4, NOW - MINUTE)]]);
    expect(merged.get("v9")).toEqual({
      hasPintDrops: false,
      latestContributorPrice: 6.4,
      latestContributorAt: NOW - MINUTE,
    });
  });

  it("yields to a Pint Drop we know is newer, so the map never steps backwards", () => {
    const input = signals([
      ["v1", { hasPintDrops: true, latestContributorPrice: 5.5, latestContributorAt: NOW - MINUTE }],
    ]);
    const merged = merge(input, [["v1", price("v1", 4.2, NOW - DAY)]]);
    expect(merged.get("v1")?.latestContributorPrice).toBe(5.5);
  });

  it("takes the submission when it is the newer observation", () => {
    const input = signals([
      ["v1", { hasPintDrops: true, latestContributorPrice: 5.5, latestContributorAt: NOW - DAY }],
    ]);
    const merged = merge(input, [["v1", price("v1", 4.2, NOW - MINUTE)]]);
    expect(merged.get("v1")?.latestContributorPrice).toBe(4.2);
  });

  it("takes the submission when the Pint Drop's age is unknown", () => {
    const input = signals([["v1", { hasPintDrops: true, latestContributorPrice: 5.5 }]]);
    const merged = merge(input, [["v1", price("v1", 4.2, NOW - MINUTE)]]);
    expect(merged.get("v1")?.latestContributorPrice).toBe(4.2);
  });

  it("never lights the has-drops halo - a logged price is not a Pint Drop", () => {
    const merged = merge(signals([["v1", { hasPintDrops: false, latestContributorPrice: null }]]), [
      ["v1", price("v1", 4.2, NOW - MINUTE)],
    ]);
    expect(merged.get("v1")?.hasPintDrops).toBe(false);
  });

  it("never restamps from a non-beer submission - pins price pints only", () => {
    const rows = [
      price("v1", 18, NOW - MINUTE, "cocktail"),
      price("v1", 4.2, NOW - DAY),
    ];
    // The pin signal ignores the fresher cocktail and keeps the beer price…
    const pin = freshestPintPrice(rows);
    expect(pin?.priceGbp).toBe(4.2);
    expect(pin?.drinkCategory).toBe("beer");
    // …while the sheet's dated community row still shows the cocktail, named.
    const sheet = freshestCommunityPrice(rows);
    expect(sheet?.priceGbp).toBe(18);
    expect(sheet?.drinkCategory).toBe("cocktail");
  });

  it("moves no pin signal at all when a venue has only non-beer submissions", () => {
    const rows = [price("v1", 12, NOW - DAY, "wine")];
    expect(freshestPintPrice(rows)).toBeNull();
    // The observation is not lost - the sheet still renders it on its own row.
    expect(freshestCommunityPrice(rows)?.drinkCategory).toBe("wine");
  });

  it("leaves untouched venues exactly as they were", () => {
    const other: PricedVenueSignal = { hasPintDrops: true, latestContributorPrice: 7 };
    const merged = merge(
      signals([
        ["v1", { hasPintDrops: false, latestContributorPrice: null }],
        ["v2", other],
      ]),
      [["v1", price("v1", 4.2, NOW - MINUTE)]],
    );
    expect(merged.get("v2")).toBe(other);
  });
});

// The trust gate (captain decision 2026-07-26, review findings F1/F4). These
// are the assertions that stop one anonymous device repainting London.
describe("mergeCommunityPriceSignals trust gate", () => {
  const baseline: PricedVenueSignal = { hasPintDrops: false, latestContributorPrice: null };

  it("does NOT restamp a pin from a single uncorroborated report", () => {
    const merged = merge(signals([["v1", baseline]]), [
      ["v1", price("v1", 4.2, NOW - MINUTE, "beer", 1)],
    ]);
    expect(merged.get("v1")?.latestContributorPrice).toBeNull();
  });

  it("restamps once a second independent submitter agrees", () => {
    const merged = merge(signals([["v1", baseline]]), [
      ["v1", price("v1", 4.2, NOW - MINUTE, "beer", 2)],
    ]);
    expect(merged.get("v1")?.latestContributorPrice).toBe(4.2);
  });

  it("treats a missing count as one voice - an unknown figure has not earned the map", () => {
    const lone: CommunityPrice = {
      venueId: "v1",
      drinkCategory: "beer",
      priceGbp: 4.2,
      submittedAt: NOW - MINUTE,
      source: "community",
    };
    expect(merge(signals([["v1", baseline]]), [["v1", lone]]).get("v1")?.latestContributorPrice)
      .toBeNull();
  });

  it("keeps driving the map on the last day inside the 30-day window", () => {
    const merged = merge(signals([["v1", baseline]]), [
      ["v1", price("v1", 4.2, NOW - COMMUNITY_PRICE_MAX_AGE_MS + MINUTE)],
    ]);
    expect(merged.get("v1")?.latestContributorPrice).toBe(4.2);
  });

  it("stops driving the map at 31 days, falling back to the scraped baseline", () => {
    const scraped: PricedVenueSignal = { hasPintDrops: false, latestContributorPrice: null };
    const merged = merge(signals([["v1", scraped]]), [
      ["v1", price("v1", 4.2, NOW - 31 * DAY)],
    ]);
    // Nothing merged at all, so the venue keeps exactly the signal it had and
    // geojson.ts falls through to venue.cheapestPrice for the pin colour.
    expect(merged.get("v1")).toBe(scraped);
  });

  it("an aged-out submission never displaces a live Pint Drop either", () => {
    const withDrop: PricedVenueSignal = {
      hasPintDrops: true,
      latestContributorPrice: 5.5,
      latestContributorAt: NOW - 40 * DAY,
    };
    // Freshest-wins alone would take the submission (it IS newer than the drop).
    // The age gate refuses first: neither observation is about tonight, and the
    // one we keep is the one already on record.
    const merged = merge(signals([["v1", withDrop]]), [["v1", price("v1", 4.2, NOW - 31 * DAY)]]);
    expect(merged.get("v1")?.latestContributorPrice).toBe(5.5);
  });

  it("allocates nothing when every candidate is gated - the map keeps its identity", () => {
    const input = signals([["v1", baseline], ["v2", baseline]]);
    const merged = merge(input, [
      ["v1", price("v1", 4.2, NOW - MINUTE, "beer", 1)],
      ["v2", price("v2", 5.0, NOW - 31 * DAY)],
    ]);
    // Identity, not just equality: React memo consumers downstream re-run the
    // whole pin scene when this map changes reference, so a gated-out render
    // must not manufacture a new one.
    expect(merged).toBe(input);
  });

  it("merges the trusted venues and leaves the gated ones alone in the same pass", () => {
    const input = signals([["v1", baseline], ["v2", baseline]]);
    const merged = merge(input, [
      ["v1", price("v1", 4.2, NOW - MINUTE, "beer", 1)],
      ["v2", price("v2", 5.0, NOW - MINUTE, "beer", 2)],
    ]);
    expect(merged).not.toBe(input);
    expect(merged.get("v1")?.latestContributorPrice).toBeNull();
    expect(merged.get("v2")?.latestContributorPrice).toBe(5);
  });
});

// The sheet is the other half of the policy: gated prices still SHOW, they just
// say where they stand. If this copy ever goes empty for a gated price the pub
// page would silently imply a restamp that never happened.
describe("communityTrustNote", () => {
  it("says nothing when the price is corroborated and current", () => {
    expect(communityTrustNote({ corroborations: 2, submittedAt: NOW - MINUTE }, NOW)).toBe("");
  });

  it("explains a lone report is awaiting confirmation", () => {
    expect(communityTrustNote({ corroborations: 1, submittedAt: NOW - MINUTE }, NOW)).toMatch(
      /awaiting confirmation/i,
    );
  });

  it("explains an aged-out price has handed the map back to the record", () => {
    expect(communityTrustNote({ corroborations: 5, submittedAt: NOW - 31 * DAY }, NOW)).toMatch(
      /30 days/i,
    );
  });

  it("leads with age when a price is both stale and uncorroborated", () => {
    // Age is the more useful fact: "confirm it" is not the advice for a price
    // that would age out again anyway.
    expect(communityTrustNote({ corroborations: 1, submittedAt: NOW - 31 * DAY }, NOW)).toMatch(
      /30 days/i,
    );
  });
});

describe("upsertPrice", () => {
  it("keeps a newer local observation when an older row arrives later", () => {
    const localBeer = price("v1", 5.2, 9_000);
    const wine = price("v1", 8.5, 2_000, "wine");
    const staleServerBeer = price("v1", 4.2, 1_000);

    expect(upsertPrice([localBeer, wine], staleServerBeer)).toEqual([
      localBeer,
      wine,
    ]);
  });
});

describe("replacePrice", () => {
  it("adopts the server record even when the optimistic row's device stamp is newer", () => {
    // Device clock ran ahead of the server: the optimistic stamp out-ranks the
    // authoritative POST response, which must still replace it.
    const optimisticBeer = price("v1", 5.2, 9_000);
    const wine = price("v1", 8.5, 2_000, "wine");
    const serverBeer = price("v1", 5.2, 8_000);

    expect(replacePrice([optimisticBeer, wine], serverBeer)).toEqual([
      serverBeer,
      wine,
    ]);
  });
});
