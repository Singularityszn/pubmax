import { describe, expect, it } from "vitest";

import type { DrinkPriceUpdate } from "@/lib/drinkPriceUpdates";
import { buildSocialAlternatives } from "@/lib/socialAlternatives";

const NOW = Date.parse("2026-11-03T12:00:00Z");
const VENUE = {
  id: "venue-lamb", name: "The Lamb", address: "1 Lamb Street", latitude: 51.5,
  longitude: -0.1, kind: "pub", prices: [],
} satisfies Parameters<typeof buildSocialAlternatives>[0][number];
const UPDATE: DrinkPriceUpdate = {
  venueKey: "the lamb|1 lamb street|51.50000|-0.10000", drinkName: "House lager", category: "beer",
  servingSize: "pint", priceGbp: 5.5, observedAt: "2026-10-30T12:00:00Z", lane: "publisher",
  source: { label: "The Lamb menu", url: "https://lamb.example/menu", licence: "facts-only" },
};

describe("public alternatives for an empty London feed", () => {
  it("keeps the exact serving, amount, publisher and read day with a real route", () => {
    const answer = buildSocialAlternatives([VENUE], [UPDATE], NOW);
    expect(answer.crawls[0]).toEqual({ name: "Victorian Soho", href: "/routes/victorian-soho", stops: 5 });
    expect(answer.prices).toEqual([{
      venueId: "venue-lamb", name: "The Lamb", href: "/map?sel=venue-lamb", drink: "House lager",
      serving: "pint", priceGbp: 5.5, publisher: { label: "The Lamb menu", url: "https://lamb.example/menu" },
      observedOn: "2026-10-30",
    }]);
    expect(answer.priceRead).toBe("ready");
  });

  it("omits incomplete, future, demo and unmatched observations", () => {
    const rejected: DrinkPriceUpdate[] = [
      { ...UPDATE, servingSize: undefined },
      { ...UPDATE, source: { ...UPDATE.source, label: " " } },
      { ...UPDATE, source: { ...UPDATE.source, url: "javascript:alert(1)" } },
      { ...UPDATE, source: { ...UPDATE.source, licence: " " } },
      { ...UPDATE, observedAt: "2026-02-30T12:00:00Z" },
      { ...UPDATE, observedAt: "2026-11-04T12:00:00Z" },
      { ...UPDATE, lane: "demo" },
      { ...UPDATE, venueKey: "a pub outside our London list" },
      { ...UPDATE, priceGbp: -1 },
    ];
    expect(buildSocialAlternatives([VENUE], rejected, NOW).prices).toEqual([]);
  });

  it("sorts by source read time and keeps one latest serving per pub", () => {
    const second = { ...VENUE, id: "venue-crown", name: "The Crown", address: "2 Crown Street" };
    const older = { ...UPDATE, observedAt: "2026-10-01T12:00:00Z", priceGbp: 2 };
    const crown = { ...UPDATE, venueKey: "the crown|2 crown street|51.50000|-0.10000", observedAt: "2026-10-31T12:00:00Z", priceGbp: 7 };
    const answer = buildSocialAlternatives([VENUE, second], [older, UPDATE, crown], NOW);
    expect(answer.prices.map((price) => [price.venueId, price.priceGbp])).toEqual([["venue-crown", 7], ["venue-lamb", 5.5]]);
  });

  it("reads the source timestamp as a London day without changing its serving", () => {
    const answer = buildSocialAlternatives([VENUE], [{ ...UPDATE, servingSize: "125ml", observedAt: "2026-07-01T23:30:00Z" }], NOW);
    expect(answer.prices[0]).toMatchObject({ serving: "125ml", priceGbp: 5.5, observedOn: "2026-07-02" });
  });

  it("distinguishes a failed read from a successful read with no eligible prices", () => {
    expect(buildSocialAlternatives([VENUE], null, NOW)).toMatchObject({ priceRead: "unavailable", prices: [] });
    expect(buildSocialAlternatives([VENUE], [], NOW)).toMatchObject({ priceRead: "ready", prices: [] });
    expect(buildSocialAlternatives([], [UPDATE], NOW)).toMatchObject({ priceRead: "unavailable", prices: [] });
  });

  it("does not offer a members-only pub as a public next action", () => {
    const venue = { ...VENUE, name: "Members only club" };
    expect(buildSocialAlternatives([venue], [{ ...UPDATE, venueKey: "members only club|1 lamb street|51.50000|-0.10000" }], NOW).prices).toEqual([]);
  });
});
