import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { drawPubTarot, pubTarotListings } from "@/lib/wildTarot";
import type { PintRoulettePoint } from "@/lib/pintRoulette";

const here = { lat: 51.5129, lng: -0.13 };
const pubs: PintRoulettePoint[] = ["a", "b", "c"].map((id) => ({
  id, name: `Pub ${id}`, borough: "Westminster", ...here,
  cheapestPrice: 5, priceSource: "Pint Prices", priceObservedAt: "2026-10-02",
}));
const heritage = { listings: Object.fromEntries(pubs.map((pub, index) => [pub.id, {
  listEntry: 1235282 + index,
  fact: "Grade II listed public house.",
  url: `https://historicengland.org.uk/listing/the-list/list-entry/${1235282 + index}`,
}])) };

describe("Pub Tarot draw", () => {
  it("draws three distinct real pubs with each pub's own linked heritage fact", () => {
    const draw = drawPubTarot(here.lat, here.lng, pubs, heritage, { random: () => 0 });
    expect(draw?.cards.map((card) => card.id)).toEqual(["a", "b", "c"]);
    expect(draw?.cards.map((card) => card.sourceUrl)).toEqual([
      "https://historicengland.org.uk/listing/the-list/list-entry/1235282",
      "https://historicengland.org.uk/listing/the-list/list-entry/1235283",
      "https://historicengland.org.uk/listing/the-list/list-entry/1235284",
    ]);
    expect(draw?.cards.every((card) => card.fact === "Grade II listed public house.")).toBe(true);
    expect(draw?.poolSize).toBe(3);
    expect(draw?.cards[0]).not.toHaveProperty("priceGbp");
  });

  it("keeps the existing budget, distance and public-pub limits without filling a short draw", () => {
    for (const patch of [
      { cheapestPrice: 7 }, { lat: 52 }, { kind: "bar" as const },
      { priceSource: undefined }, { priceObservedAt: "2040-01-01" },
      { measure: "half pint" },
    ]) {
      expect(drawPubTarot(here.lat, here.lng, [pubs[0]!, pubs[1]!, { ...pubs[2]!, ...patch }], heritage, { random: () => 0, priceCapGbp: 6 })).toBeNull();
    }
  });

  it.each([
    "javascript:alert(1)", "http://historicengland.org.uk/listing/the-list/list-entry/1235284",
    "https://historicengland.org.uk.evil.test/listing/the-list/list-entry/1235284",
    "https://user@historicengland.org.uk/listing/the-list/list-entry/1235284",
    "https://historicengland.org.uk/listing/the-list/list-entry/1235284?next=https://evil.test",
    "https://historicengland.org.uk/listing/the-list/list-entry/9999999",
  ])("refuses an unsafe or mismatched heritage link: %s", (url) => {
    const data = structuredClone(heritage);
    data.listings.c!.url = url;
    expect(drawPubTarot(here.lat, here.lng, pubs, data, { random: () => 0 })).toBeNull();
  });

  it("never borrows another pub's citation or duplicates a card", () => {
    const data = structuredClone(heritage); delete data.listings.c;
    expect(drawPubTarot(here.lat, here.lng, [...pubs, pubs[0]!], data, { random: () => 0 })).toBeNull();
    data.listings.c = { ...heritage.listings.c!, fact: " " };
    expect(drawPubTarot(here.lat, here.lng, pubs, data, { random: () => 0 })).toBeNull();
  });

  it("distinguishes an unreadable asset from an eligible pool smaller than three", () => {
    expect(() => pubTarotListings({})).toThrow("Heritage listings unavailable");
    expect(drawPubTarot(here.lat, here.lng, pubs, { listings: {} }, { random: () => 0 })).toBeNull();
  });

  it("draws without replacement when the random source reaches its limits", () => {
    for (const random of [() => 0, () => 0.99, () => Number.NaN, () => 1]) {
      const draw = drawPubTarot(here.lat, here.lng, [...pubs, pubs[0]!], heritage, { random });
      expect(new Set(draw?.cards.map((card) => card.id)).size).toBe(3);
    }
  });

  it("can draw the three audited London pubs from the shipped pool and heritage asset", () => {
    const slim = JSON.parse(readFileSync(new URL("../public/data/venues_slim.json", import.meta.url), "utf8")) as { rows: PintRoulettePoint[] };
    const stored = JSON.parse(readFileSync(new URL("../public/data/heritage_listings.json", import.meta.url), "utf8"));
    const audited = ["venue-phqazo", "venue-xiesdn", "venue-1ufn31x"];
    const draw = drawPubTarot(here.lat, here.lng, slim.rows.filter((pub) => audited.includes(pub.id)), stored, { random: () => 0, priceCapGbp: 7 });
    expect(new Set(draw?.cards.map((card) => card.id))).toEqual(new Set(audited));
    expect(draw?.cards.map((card) => card.fact)).toEqual([
      "Grade II listed public house.", "Grade II listed building.", "Grade II listed public house.",
    ]);
  });
});
