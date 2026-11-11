import { describe, expect, it } from "vitest";

import type { DrinkPriceUpdate } from "@/lib/drinkPriceUpdates";
import { buildSocialAlternatives } from "@/lib/socialAlternatives";
import type { UkPriceBundleRow } from "@/lib/ukPriceBundle";

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
const BUNDLE: UkPriceBundleRow = {
  venueId: "venue-uk-w770044829", name: "Silver Fox", category: "beer", priceGbp: 4.8,
  lane: "site-harvest", standing: "listed", sourceUrl: "https://www.silverfoxmicropub.com/drinks",
  publisher: "silverfoxmicropub.com", observedAt: "2026-10-19T16:21:29.579Z", basis: null, sampleSize: null,
  servingSize: "Pint", drinkLabel: "Kent Best Bitter",
};
const WINE: UkPriceBundleRow = {
  ...BUNDLE, category: "wine", priceGbp: 6, observedAt: "2026-11-01T16:21:29.579Z",
  servingSize: "187ml", drinkLabel: "HIDDEN ROAD, MERLOT 13% Spanish medium bodied",
};
const SILVER_FOX = {
  id: BUNDLE.venueId, name: "Silver Fox", address: "9, Montpelier Avenue, Bexley, DA5 3AP",
  latitude: 51.44217, longitude: 0.12567, kind: "pub", prices: [],
} satisfies Parameters<typeof buildSocialAlternatives>[0][number];

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
      { ...UPDATE, servingSize: "half pint" },
      { ...UPDATE, servingSize: "125ml", category: "wine", drinkName: "House red" },
      { ...UPDATE, drinkName: "House lager 330ml bottle" },
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
    const answer = buildSocialAlternatives([VENUE], [{ ...UPDATE, servingSize: "Pint", observedAt: "2026-07-01T23:30:00Z" }], NOW);
    expect(answer.prices[0]).toMatchObject({ serving: "Pint", priceGbp: 5.5, observedOn: "2026-07-02" });
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

  it("orders both public packs together and keeps only pint servings", () => {
    const older = { ...UPDATE, observedAt: "2026-10-13T12:00:00Z" };
    const answer = buildSocialAlternatives([VENUE, SILVER_FOX], [older], NOW, [WINE, BUNDLE]);
    expect(answer.prices.map((price) => [price.venueId, price.serving, price.observedOn])).toEqual([
      ["venue-uk-w770044829", "Pint", "2026-10-19"], ["venue-lamb", "pint", "2026-10-13"],
    ]);
    expect(answer.prices[0]).toEqual({
      venueId: "venue-uk-w770044829", name: "Silver Fox", href: "/map?sel=venue-uk-w770044829",
      drink: "Kent Best Bitter", serving: "Pint", priceGbp: 4.8,
      publisher: { label: "silverfoxmicropub.com", url: "https://www.silverfoxmicropub.com/drinks" },
      observedOn: "2026-10-19",
    });
    const newer = { ...UPDATE, observedAt: "2026-10-30T12:00:00Z" };
    expect(buildSocialAlternatives([VENUE, SILVER_FOX], [newer], NOW, [BUNDLE]).prices[0]?.venueId).toBe("venue-lamb");
    expect(buildSocialAlternatives([SILVER_FOX], [], NOW, [WINE])).toMatchObject({ priceRead: "ready", prices: [] });
  });

  it("rejects ambiguous venue keys in both public packs regardless of input order", () => {
    const otherLamb = { ...VENUE, id: "venue-other-lamb" };
    const otherFox = { ...SILVER_FOX, name: "Another Fox" };
    for (const venues of [[VENUE, otherLamb, SILVER_FOX, otherFox], [otherFox, SILVER_FOX, otherLamb, VENUE]]) {
      expect(buildSocialAlternatives(venues, [UPDATE], NOW, [BUNDLE]).prices).toEqual([]);
    }
  });

  it("rejects unplaced, non-London and restricted bundle identities", () => {
    const identities: Parameters<typeof buildSocialAlternatives>[0][number][] = [
      { ...SILVER_FOX, latitude: NaN },
      { ...SILVER_FOX, latitude: 53.48, longitude: -2.24 },
      { ...SILVER_FOX, name: "Members only club" },
      { ...SILVER_FOX, kind: "bar" },
    ];
    for (const identity of identities) {
      expect(buildSocialAlternatives([identity], [], NOW, [BUNDLE]).prices).toEqual([]);
    }
    expect(buildSocialAlternatives([{ ...VENUE, latitude: 53.48, longitude: -2.24 }], [{ ...UPDATE, venueKey: VENUE.id }], NOW).prices).toEqual([]);
  });

  it("rejects quarantined, estimated, future and incomplete bundle observations", () => {
    const rejected: UkPriceBundleRow[] = [
      { ...BUNDLE, standing: "estimate", lane: "estimate" },
      { ...BUNDLE, observedAt: "2026-11-04T12:00:00Z" },
      { ...BUNDLE, observedAt: "2026-02-30T12:00:00Z" },
      { ...BUNDLE, servingSize: undefined },
      { ...BUNDLE, publisher: null },
      { ...BUNDLE, sourceUrl: "javascript:alert(1)" },
      { ...BUNDLE, drinkLabel: undefined },
      { ...BUNDLE, priceGbp: -1 },
      { ...BUNDLE, venueId: "venue-unknown" },
      { ...BUNDLE, sourceUrl: "https://loreoftheland.com/menu/drinks-menu/", category: "gin", priceGbp: 16.5, drinkLabel: "Fever & Fauna" },
    ];
    expect(buildSocialAlternatives([SILVER_FOX], [], NOW, rejected).prices).toEqual([]);
    expect(buildSocialAlternatives([SILVER_FOX], [], NOW, null)).toMatchObject({ priceRead: "unavailable", prices: [] });
  });
});
