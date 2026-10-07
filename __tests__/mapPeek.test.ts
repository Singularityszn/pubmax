import { describe, expect, it } from "vitest";

import { buildMapPeek, MAP_PEEK_MAX_WALK_MINUTES, mapPeekSummary } from "@/lib/mapPeek";
import { buildMapVenueListModel } from "@/lib/mapVenueList";
import type { Venue } from "@/lib/venues";

function pub(overrides: Partial<Venue> & { id: string }): Venue {
  return {
    name: `Pub ${overrides.id}`,
    latitude: 51.5,
    longitude: -0.12,
    cheapestPrice: null,
    kind: "pub",
    ...overrides,
  } as Venue;
}

const READER = { lat: 51.5, lng: -0.12 };

describe("buildMapPeek", () => {
  it("makes no claim until the visible projection has landed", () => {
    expect(buildMapPeek({ ready: false, venues: [pub({ id: "a", cheapestPrice: 3 })] }))
      .toEqual({ status: "loading" });
  });

  it("is honest-empty when no pub in view carries a price", () => {
    expect(buildMapPeek({ ready: true, venues: [pub({ id: "a" }), pub({ id: "b" })] }))
      .toEqual({ status: "none" });
    expect(buildMapPeek({ ready: true, venues: [] })).toEqual({ status: "none" });
  });

  it("names the cheapest listed pub and its figure", () => {
    const model = buildMapPeek({
      ready: true,
      venues: [
        pub({ id: "dear", name: "The Dear", cheapestPrice: 7.2 }),
        pub({ id: "cheap", name: "The Three Tuns", cheapestPrice: 2.95 }),
        pub({ id: "mid", name: "The Mid", cheapestPrice: 5 }),
      ],
    });
    expect(model).toMatchObject({
      status: "answer",
      answer: { venueId: "cheap", name: "The Three Tuns", priceGbp: 2.95, priceLabel: "£2.95" },
    });
  });

  it("prefers a contributor's fresher figure, the same authority the pins wear", () => {
    const model = buildMapPeek({
      ready: true,
      venues: [pub({ id: "a", cheapestPrice: 4 }), pub({ id: "b", cheapestPrice: 3.5 })],
      venueSignals: new Map([["a", { latestContributorPrice: 3 }]]),
    });
    expect(model).toMatchObject({ status: "answer", answer: { venueId: "a", priceGbp: 3 } });
  });

  it("breaks a tie on name then id so the card never flickers between two pubs", () => {
    const venues = [
      pub({ id: "z", name: "Zebra", cheapestPrice: 4 }),
      pub({ id: "a", name: "Anchor", cheapestPrice: 4 }),
    ];
    const first = buildMapPeek({ ready: true, venues });
    const second = buildMapPeek({ ready: true, venues: [...venues].reverse() });
    expect(first).toEqual(second);
    expect(first).toMatchObject({ answer: { name: "Anchor" } });
  });

  it("never lets a non-pub win the pint default", () => {
    const model = buildMapPeek({
      ready: true,
      venues: [
        pub({ id: "shop", kind: "restaurant" as Venue["kind"], cheapestPrice: 1 }),
        pub({ id: "p", cheapestPrice: 4 }),
      ],
    });
    expect(model).toMatchObject({ answer: { venueId: "p" } });
  });

  it("agrees with the first row of List view's cheapest sort", () => {
    const venues = [
      pub({ id: "a", name: "A", cheapestPrice: 6 }),
      pub({ id: "b", name: "B", cheapestPrice: 3.1 }),
      pub({ id: "c", name: "C", cheapestPrice: 4.4 }),
      pub({ id: "d", name: "D" }),
    ];
    const peek = buildMapPeek({ ready: true, venues });
    const list = buildMapVenueListModel(venues, [-0.12, 51.5], undefined, null, undefined, "ready", "cheapest");
    expect(peek).toMatchObject({ answer: { venueId: list.rows[0]?.id } });
  });

  describe("walk time", () => {
    const venues = [pub({ id: "near", cheapestPrice: 3, latitude: 51.5, longitude: -0.12 })];

    it("is omitted without the reader's own fix, never read off the map centre", () => {
      expect(buildMapPeek({ ready: true, venues })).toMatchObject({ answer: { walkMinutes: null } });
      expect(buildMapPeek({ ready: true, venues, reader: null }))
        .toMatchObject({ answer: { walkMinutes: null } });
    });

    it("is a whole positive number of minutes from a fix", () => {
      const model = buildMapPeek({
        ready: true,
        venues: [pub({ id: "n", cheapestPrice: 3, latitude: 51.5, longitude: -0.12 })],
        reader: { lat: 51.504, lng: -0.12 },
      });
      expect(model).toMatchObject({ answer: { walkMinutes: 6 } });
      const co = buildMapPeek({ ready: true, venues, reader: READER });
      expect(co).toMatchObject({ answer: { walkMinutes: 1 } });
    });

    it("is left off past the long-walk ceiling rather than printing a trip", () => {
      const far = buildMapPeek({
        ready: true,
        venues,
        reader: { lat: 51.65, lng: -0.12 },
      });
      expect(far).toMatchObject({ answer: { walkMinutes: null } });
      expect(MAP_PEEK_MAX_WALK_MINUTES).toBe(30);
    });
  });
});

describe("mapPeekSummary", () => {
  it("says one honest line per state", () => {
    expect(mapPeekSummary({ status: "loading" })).toBe("Looking for the cheapest price in view");
    expect(mapPeekSummary({ status: "none" })).toBe("No listed price in this view");
    expect(
      mapPeekSummary({
        status: "answer",
        answer: { venueId: "a", name: "The Three Tuns", priceGbp: 2.95, priceLabel: "£2.95", walkMinutes: 6 },
      }),
    ).toBe("Cheapest in this view: £2.95 at The Three Tuns, 6 minute walk");
  });
});
