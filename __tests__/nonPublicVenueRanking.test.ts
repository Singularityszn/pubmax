import { describe, expect, it } from "vitest";

import { listBoroughs, pubsInBorough } from "@/lib/boroughs";
import { rankCityCheapest, rankNearMe, type PricedPoint } from "@/lib/nearMeAnswer";
import { tonightCheapPints } from "@/lib/tonightCheapPints";
import { isNonPublicVenueName, isPublicRankablePub } from "@/lib/venueKindFilters";
import type { Venue } from "@/lib/venues";

// THE CHEAPEST-PINT RANKINGS ARE FOR BARS A STRANGER CAN WALK INTO. One rule
// (lib/venueKindFilters.ts) and every ranking reads it; the rows themselves stay
// in the dataset and on the map.

const THREE_TUNS = "The Three Tuns - LSE Student Union";

describe("isNonPublicVenueName", () => {
  it.each([
    THREE_TUNS,
    "Hannafords Student Bar",
    "King's College Students' Union Bar",
    "The Tuns (SU)",
    "UCL SU Phineas",
    "Bexleyheath Working Mens Club",
    "Langham Working Men's Club",
    "Orford House Social Club",
    "Finchley United Services Club Ltd",
    "Feltham Constitutional Club",
    "South West Ham Labour Club",
    "Paddington Railway Club",
    "Leyton Orient Supporters Club",
    "Royal British Legion Hendon",
    "The Staff Bar",
    "Members Only Bar",
    // A university's initials joined to SU (Birmingham's hunt winner, 1 Nov 2026).
    "Eagle & Ball by BCUSU",
    "The Three Tuns, LSESU",
    "Students Union Bar",
  ])("reads %s as not open to the public", (name) => {
    expect(isNonPublicVenueName(name)).toBe(true);
  });

  it.each([
    "The Union",
    "Galvanisers Union",
    "Union Chiswick",
    "Flight Club",
    "Up the Creek Comedy Club",
    "Club 182",
    "The College Arms",
    "Sun Inn",
    "The Surrey Docks",
    "Nags Head, Peckham",
    // Capitals that merely end in SU, or initials in lower case, are not a union.
    "Misu Bar",
    "The Bcusu Arms",
    "SUSHI SAMBA",
  ])("leaves %s in the rankings", (name) => {
    expect(isNonPublicVenueName(name)).toBe(false);
  });

  it("is the pub-kind rule plus the access rule", () => {
    expect(isPublicRankablePub({ name: "The Prince Edward" })).toBe(true);
    expect(isPublicRankablePub({ name: "The Prince Edward", kind: "bar" })).toBe(false);
    expect(isPublicRankablePub({ name: THREE_TUNS, kind: "pub" })).toBe(false);
  });
});

describe("every cheapest-pint ranking reads the one rule", () => {
  it("Tonight's cheapest listed pints skip a students' union bar", () => {
    const rows = tonightCheapPints([
      { id: "tuns", name: THREE_TUNS, primaryBorough: "Westminster", cheapestPrice: 2.95 },
      { id: "edward", name: "The Prince Edward", primaryBorough: "Westminster", cheapestPrice: 3.5 },
    ]);
    expect(rows.map((row) => row.venueId)).toEqual(["edward"]);
  });

  it("Near me and the city ranking skip it too", () => {
    const points: PricedPoint[] = [
      { id: "tuns", name: THREE_TUNS, borough: "Westminster", lat: 51.5145, lng: -0.1165, cheapestPrice: 2.95 },
      { id: "edward", name: "The Prince Edward", borough: "Westminster", lat: 51.5146, lng: -0.1166, cheapestPrice: 3.5 },
    ];
    expect(rankCityCheapest(points).map((card) => card.id)).toEqual(["edward"]);
    expect(rankNearMe(51.5145, -0.1165, points, { minAnswers: 1 }).cards.map((card) => card.id)).toEqual([
      "edward",
    ]);
  });

  it("a borough page keeps the row but never ranks it on price", () => {
    const v = (over: Partial<Venue>): Venue =>
      ({ primaryBorough: "Westminster", visibleBoroughs: [], cheapestPint: "", ...over }) as Venue;
    const venues = [
      v({ id: "tuns", name: THREE_TUNS, cheapestPrice: 2.95 }),
      v({ id: "edward", name: "The Prince Edward", cheapestPrice: 3.5 }),
      v({ id: "alma", name: "Alma", cheapestPrice: 5 }),
    ];
    expect(pubsInBorough(venues, "westminster").map((venue) => venue.id)).toEqual([
      "edward",
      "alma",
      "tuns",
    ]);
    expect(listBoroughs(venues)[0]?.cheapestGbp).toBe(3.5);
  });
});
