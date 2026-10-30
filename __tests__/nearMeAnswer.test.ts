import { describe, it, expect } from "vitest";

import {
  boroughsWithPrices,
  nearSavingLine,
  nearestListedPub,
  rankBoroughCheapest,
  rankCityCheapest,
  rankNearMe,
  walkMinutesFromKm,
  type PricedPoint,
} from "@/lib/nearMeAnswer";
import type { VenueKind } from "@/lib/venues";

// A user standing at a central London point.
const here = { lat: 51.5074, lng: -0.1278 };

// ~0.1 km east ≈ one street over. Longitude degrees are ~69 km at London's
// latitude, so 0.001° ≈ 0.07 km — handy for placing fixtures at known-ish
// distances without hand-computing haversine.
function at(
  id: string,
  dLat: number,
  dLng: number,
  price: number | null,
  borough = "Camden",
  kind?: VenueKind,
): PricedPoint {
  return {
    id,
    name: `Pub ${id}`,
    lat: here.lat + dLat,
    lng: here.lng + dLng,
    cheapestPrice: price,
    priceSource: "Pub menu",
    priceObservedAt: "2026-01-01",
    borough,
    ...(kind !== undefined ? { kind } : {}),
  };
}

describe("walkMinutesFromKm", () => {
  it("floors at 1 minute and never returns 0 or negatives", () => {
    expect(walkMinutesFromKm(0)).toBe(1);
    expect(walkMinutesFromKm(-5)).toBe(1);
    expect(walkMinutesFromKm(0.02)).toBe(1);
  });

  it("uses ~80 m/min so 1 km reads ~12–13 min", () => {
    expect(walkMinutesFromKm(1)).toBe(13);
    expect(walkMinutesFromKm(0.8)).toBe(10);
  });

  it("is tolerant of non-finite input", () => {
    expect(walkMinutesFromKm(Number.NaN)).toBe(1);
    expect(walkMinutesFromKm(Number.POSITIVE_INFINITY)).toBe(1);
  });
});

describe("Near Me branch identity", () => {
  const branches: PricedPoint[] = [
    { ...at("venue-nyowgc", 0, 0, 6.15, "Westminster"), name: "Coach & Horses", address: "1 Great Malborough Street, W1F 7HG" },
    { ...at("venue-phqazo", 0.002, 0, 5.7, "Westminster"), name: "The Coach & Horses", address: "29 Greek St, London W1D 5DH" },
  ];

  it.each([
    ["walkable", (points: PricedPoint[]) => rankNearMe(here.lat, here.lng, points, { minAnswers: 1 }).cards],
    ["widened", (points: PricedPoint[]) => rankNearMe(here.lat, here.lng, points).cards],
    ["borough", (points: PricedPoint[]) => rankBoroughCheapest(points, "Westminster")],
    ["city", (points: PricedPoint[]) => rankCityCheapest(points)],
  ] as const)("distinguishes the two pubs in the %s answer without changing their prices", (_, rank) => {
    expect(rank(branches).map((card) => [card.id, card.name, card.cheapestPrice])).toEqual([
      ["venue-phqazo", "The Coach & Horses (29 Greek St)", 5.7],
      ["venue-nyowgc", "Coach & Horses (1 Great Malborough Street)", 6.15],
    ]);
  });

  it("distinguishes a nearest namesake outside the capped cards", () => {
    const answer = rankNearMe(here.lat, here.lng, branches, { minAnswers: 1, maxAnswers: 1 });
    expect(answer.nearest?.name).toBe("Coach & Horses (1 Great Malborough Street)");
    expect(nearSavingLine(answer.cards, answer.nearest)).toBe(
      "The Coach & Horses (29 Greek St) is £0.45 a pint less than Coach & Horses (1 Great Malborough Street), the nearest pub with a listed price (£6.15, right here).",
    );
  });

  it("uses the recorded area when an address is absent and keeps a street after a separate house number", () => {
    const cards = rankCityCheapest([
      { ...branches[0]!, address: "8, Kew Green, TW9 3BH" },
      { ...branches[1]!, address: "", locality: "Soho" },
    ]);
    expect(cards.map((card) => card.name)).toEqual([
      "The Coach & Horses (Soho)", "Coach & Horses (8 Kew Green)",
    ]);
  });

  it("keeps a single pub's name when the nearest pub is the same record", () => {
    const answer = rankNearMe(here.lat, here.lng, [branches[0]!], { minAnswers: 1 });
    expect(answer.cards[0]?.name).toBe("Coach & Horses");
    expect(answer.nearest?.name).toBe("Coach & Horses");
    expect(nearSavingLine(answer.cards, answer.nearest)).toBeNull();
  });
});

describe("nearestListedPub", () => {
  it("chooses distance before price or operator and preserves the cheapest-pint answer", () => {
    const venues: PricedPoint[] = [
      { ...at("spoons", 0.004, 0, 3.2), name: "The Example - JD Wetherspoon" },
      { ...at("independent", 0.0002, 0, 7), name: "The Local" },
      at("middle", 0.002, 0, 5),
    ];

    expect(nearestListedPub(here.lat, here.lng, venues)?.id).toBe("independent");
    expect(rankNearMe(here.lat, here.lng, venues).cards.map((card) => card.id))
      .toEqual(["spoons", "middle", "independent"]);
  });

  it("keeps a nearer unpriced pub eligible without inventing a pint price", () => {
    const venues = [at("cheap", 0.004, 0, 3.2), at("unpriced", 0.0001, 0, null)];

    expect(nearestListedPub(here.lat, here.lng, venues)).toMatchObject({
      id: "unpriced", walkMinutes: 1,
    });
    expect(rankNearMe(here.lat, here.lng, venues).cards.map((card) => card.id)).toEqual(["cheap"]);
    expect(venues[1]?.cheapestPrice).toBeNull();
  });

  it.each(["bar", "cafe", "restaurant", "food", "club", "other"] as const)(
    "does not call a nearer %s the nearest pub",
    (kind) => {
      const venues = [at("non-pub", 0, 0, 2, "Camden", kind), at("public", 0.001, 0, null, "Camden", "pub")];
      expect(nearestListedPub(here.lat, here.lng, venues)?.id).toBe("public");
    },
  );

  it.each(["Members Only Bar", "Students' Union Bar", "Staff Club", "Working Men's Club"])(
    "excludes a closer private venue named %s",
    (name) => {
      const venues = [{ ...at("private", 0, 0, 2), name }, at("public", 0.001, 0, null)];
      expect(nearestListedPub(here.lat, here.lng, venues)?.id).toBe("public");
    },
  );

  it.each([
    { lat: Number.NaN, lng: here.lng },
    { lat: here.lat, lng: Number.POSITIVE_INFINITY },
    { lat: 91, lng: here.lng },
    { lat: -91, lng: here.lng },
    { lat: here.lat, lng: 181 },
    { lat: here.lat, lng: -181 },
  ])("refuses invalid origin coordinates $lat, $lng", ({ lat, lng }) => {
    expect(nearestListedPub(lat, lng, [at("public", 0, 0, null)])).toBeNull();
  });

  it("ignores venues with non-finite or out-of-range coordinates", () => {
    const invalid = [
      { lat: Number.NaN, lng: here.lng },
      { lat: here.lat, lng: Number.NEGATIVE_INFINITY },
      { lat: 91, lng: here.lng },
      { lat: -91, lng: here.lng },
      { lat: here.lat, lng: 181 },
      { lat: here.lat, lng: -181 },
    ].map((coordinates, index) => ({ ...at(`invalid-${index}`, 0, 0, 1), ...coordinates }));

    expect(nearestListedPub(here.lat, here.lng, [...invalid, at("valid", 0.001, 0, null)])?.id).toBe("valid");
    expect(nearestListedPub(here.lat, here.lng, invalid)).toBeNull();
  });

  it("breaks equal-distance ties by venue ID regardless of input order", () => {
    const a = at("a", 0.001, 0, null);
    const z = at("z", 0.001, 0, 2);
    expect(nearestListedPub(here.lat, here.lng, [z, a])?.id).toBe("a");
    expect(nearestListedPub(here.lat, here.lng, [a, z])?.id).toBe("a");
  });

  it("returns no nearest pub for an empty list or an ineligible list", () => {
    expect(nearestListedPub(here.lat, here.lng, [])).toBeNull();
    expect(nearestListedPub(here.lat, here.lng, [at("cafe", 0, 0, 2, "Camden", "cafe")])).toBeNull();
  });

  it("accepts coordinate boundaries and gives a co-located pub a one-minute estimate", () => {
    const venue = { ...at("at-origin", 0, 0, null), lat: 90, lng: 180 };
    expect(nearestListedPub(90, 180, [venue])).toMatchObject({
      id: "at-origin", distanceKm: 0, walkMinutes: 1,
    });
  });

  it("reports a kilometre distance and a rounded walking estimate", () => {
    // One hundredth of a degree of latitude is about 1.112 km.
    const venue = { ...at("one-kilometre", 0, 0, null), lat: 0.01, lng: 0 };
    const answer = nearestListedPub(0, 0, [venue]);
    expect(answer?.distanceKm).toBeCloseTo(1.112, 2);
    expect(answer?.walkMinutes).toBe(14);
  });

  it("names a namesake nearest pub by branch when a shown card shares its name", () => {
    const venues: PricedPoint[] = [
      { ...at("venue-nyowgc", 0, 0, null, "Westminster"), name: "Coach & Horses", address: "1 Great Malborough Street, W1F 7HG" },
      { ...at("venue-phqazo", 0.002, 0, 5.7, "Westminster"), name: "The Coach & Horses", address: "29 Greek St, London W1D 5DH" },
    ];
    expect(nearestListedPub(here.lat, here.lng, venues, ["venue-phqazo"])?.name)
      .toBe("Coach & Horses (1 Great Malborough Street)");
    // With no namesake on screen the pub keeps its own name.
    expect(nearestListedPub(here.lat, here.lng, venues)?.name).toBe("Coach & Horses");
    expect(nearestListedPub(here.lat, here.lng, venues, ["venue-nyowgc"])?.name).toBe("Coach & Horses");
  });

  it("reads a frozen venue list without sorting or changing its rows", () => {
    const venues = Object.freeze([
      Object.freeze(at("far", 0.004, 0, 3.2)),
      Object.freeze(at("near", 0.0001, 0, null)),
    ]);
    expect(nearestListedPub(here.lat, here.lng, venues)?.id).toBe("near");
    expect(venues.map((venue) => venue.id)).toEqual(["far", "near"]);
  });
});

describe("rankNearMe — walkable answer", () => {
  const venues: PricedPoint[] = [
    at("cheap-far", 0.006, 0.006, 4.5), // priced, near edge of walk ring, cheapest
    at("dear-close", 0.0005, 0.0005, 7.2), // nearest but dearest
    at("mid", 0.002, 0.002, 5.5),
    at("no-price", 0.0006, 0.0006, null), // disqualified: no observation
    at("far-away", 0.2, 0.2, 3.0), // priced but ~25 km — outside walk ring
  ];

  it("returns priced pubs within the walk ring, cheapest first", () => {
    const answer = rankNearMe(here.lat, here.lng, venues);
    expect(answer.scope).toBe("walkable");
    expect(answer.cards.map((c) => c.id)).toEqual(["cheap-far", "mid", "dear-close"]);
  });

  it("excludes pubs with no price observation (the quality bar)", () => {
    const answer = rankNearMe(here.lat, here.lng, venues);
    expect(answer.cards.some((c) => c.id === "no-price")).toBe(false);
  });

  it("does not rank an anchor or a figure without its own evidence", () => {
    const answer = rankNearMe(here.lat, here.lng, [
      { ...at("half", 0, 0, 3.4), anchorLabel: "Half pint house lager" },
      { ...at("unknown", 0, 0, 3.5), priceSource: undefined },
      at("pint", 0, 0, 5),
    ]);
    expect(answer.cards.map((card) => card.id)).toEqual(["pint"]);
  });

  it("excludes priced cocktail and food anchors", () => {
    const answer = rankNearMe(here.lat, here.lng, [
      ...venues,
      at("cocktail", 0.0001, 0.0001, 2, "Camden", "bar"),
      at("doner", 0.0002, 0.0002, 3, "Camden", "food"),
    ]);
    expect(answer.cards.map((card) => card.id)).toEqual([
      "cheap-far",
      "mid",
      "dear-close",
    ]);
  });

  it("excludes pubs outside the walk ring from the walkable answer", () => {
    const answer = rankNearMe(here.lat, here.lng, venues);
    expect(answer.cards.some((c) => c.id === "far-away")).toBe(false);
  });

  it("stamps each card with distance and walking minutes", () => {
    const answer = rankNearMe(here.lat, here.lng, venues);
    for (const card of answer.cards) {
      expect(card.distanceKm).toBeGreaterThan(0);
      expect(card.walkMinutes).toBeGreaterThanOrEqual(1);
    }
  });

  it("caps the answer at maxAnswers", () => {
    const many: PricedPoint[] = Array.from({ length: 10 }, (_, i) =>
      at(`p${i}`, 0.0005 * (i + 1), 0.0005 * (i + 1), 4 + i * 0.1),
    );
    const answer = rankNearMe(here.lat, here.lng, many, { maxAnswers: 4 });
    expect(answer.cards).toHaveLength(4);
  });
});

describe("rankNearMe — widening when nearby is thin", () => {
  it("widens honestly to nearest priced pubs when < min qualify within the walk ring", () => {
    const venues: PricedPoint[] = [
      at("walk-1", 0.001, 0.001, 6), // only ONE within the walk ring
      at("out-1", 0.02, 0.02, 4.5), // ~2.6 km — outside walk, inside widened
      at("out-2", 0.015, 0.015, 5.0),
    ];
    const answer = rankNearMe(here.lat, here.lng, venues, { minAnswers: 3 });
    expect(answer.scope).toBe("widened");
    expect(answer.cards.length).toBeGreaterThanOrEqual(1);
    // still cheapest-first among the nearest set
    const prices = answer.cards.map((c) => c.cheapestPrice);
    expect([...prices]).toEqual([...prices].sort((a, b) => a - b));
  });

  it("reports scope none and no cards when nothing is priced anywhere", () => {
    const venues: PricedPoint[] = [at("a", 0.001, 0.001, null), at("b", 0.002, 0.002, null)];
    const answer = rankNearMe(here.lat, here.lng, venues);
    expect(answer.scope).toBe("none");
    expect(answer.cards).toEqual([]);
  });

  it("is safe on empty input", () => {
    const answer = rankNearMe(here.lat, here.lng, []);
    expect(answer.scope).toBe("none");
    expect(answer.cards).toEqual([]);
  });
});

describe("rankBoroughCheapest", () => {
  const venues: PricedPoint[] = [
    at("cam-dear", 0.01, 0.01, 6.8, "Camden"),
    at("cam-cheap", 0.02, 0.02, 4.2, "Camden"),
    at("south", 0.03, 0.03, 3.9, "Southwark"),
    at("cam-noprice", 0.04, 0.04, null, "Camden"),
  ];

  it("returns cheapest-first priced pubs for the borough, case-insensitive", () => {
    const cards = rankBoroughCheapest(venues, "camden");
    expect(cards.map((c) => c.id)).toEqual(["cam-cheap", "cam-dear"]);
    expect(cards.every((c) => c.distanceKm === undefined)).toBe(true);
  });

  it("does not list non-pub anchors in borough results", () => {
    const withAnchors = [
      ...venues,
      at("cocktail", 0.001, 0.001, 2, "Camden", "bar"),
      at("doner", 0.001, 0.001, 3, "Camden", "food"),
    ];
    expect(rankBoroughCheapest(withAnchors, "Camden").map((card) => card.id)).toEqual([
      "cam-cheap",
      "cam-dear",
    ]);
  });

  it("returns nothing for an empty borough string", () => {
    expect(rankBoroughCheapest(venues, "  ")).toEqual([]);
  });
});

describe("boroughsWithPrices", () => {
  it("lists only boroughs with a priced pub, alphabetical, deduped", () => {
    const venues: PricedPoint[] = [
      at("a", 0, 0.001, 5, "Southwark"),
      at("b", 0, 0.002, 5, "Camden"),
      at("c", 0, 0.003, null, "Hackney"), // no price → excluded
      at("d", 0, 0.004, 5, "Camden"), // dupe borough
      at("e", 0, 0.005, 2, "Hackney", "bar"),
    ];
    expect(boroughsWithPrices(venues)).toEqual(["Camden", "Southwark"]);
  });
});

describe("withoutWalkTimes", () => {
  it("strips distance and walk minutes and keeps everything else", async () => {
    const { withoutWalkTimes } = await import("@/lib/nearMeAnswer");
    const cards = [
      { id: "a", name: "A", borough: "Westminster", cheapestPrice: 4.5, distanceKm: 0.02, walkMinutes: 1 },
      { id: "b", name: "B", borough: "Camden", cheapestPrice: 5.1 },
    ];
    expect(withoutWalkTimes(cards)).toEqual([
      { id: "a", name: "A", borough: "Westminster", cheapestPrice: 4.5 },
      { id: "b", name: "B", borough: "Camden", cheapestPrice: 5.1 },
    ]);
  });
});

describe("nearSavingLine: what the first answer is worth against the doorstep pub", () => {
  const venues: PricedPoint[] = [
    at("cheap-far", 0.006, 0.006, 4.5),
    at("dear-close", 0.001, 0.001, 7.2), // ~0.13 km: past "right here"
    at("mid", 0.002, 0.002, 5.5),
    at("no-price", 0.0001, 0.0001, null), // closer still, but unpriced: never the comparison
  ];

  it("names the nearest priced pub, whatever its price", () => {
    expect(rankNearMe(here.lat, here.lng, venues).nearest?.id).toBe("dear-close");
  });

  it("states the per-pint gap between two listed prices and where the doorstep pub is", () => {
    const answer = rankNearMe(here.lat, here.lng, venues);
    expect(nearSavingLine(answer.cards, answer.nearest)).toBe(
      "Pub cheap-far is £2.70 a pint less than Pub dear-close, the nearest pub with a listed price (£7.20, 0.1 km).",
    );
  });

  it("says nothing when the nearest pub is the answer", () => {
    const answer = rankNearMe(here.lat, here.lng, [
      at("cheap-close", 0.0005, 0.0005, 4.0),
      at("dear-far", 0.004, 0.004, 6.0),
      at("mid", 0.002, 0.002, 5.0),
    ]);
    expect(answer.nearest?.id).toBe("cheap-close");
    expect(nearSavingLine(answer.cards, answer.nearest)).toBeNull();
  });

  it("says nothing for a gap under 10p", () => {
    const answer = rankNearMe(here.lat, here.lng, [
      at("a", 0.004, 0.004, 5.0),
      at("b", 0.0005, 0.0005, 5.05),
      at("c", 0.002, 0.002, 5.08),
    ]);
    expect(nearSavingLine(answer.cards, answer.nearest)).toBeNull();
  });

  it("has no doorstep pub outside the walkable scope", () => {
    const answer = rankNearMe(here.lat, here.lng, [at("only", 0.01, 0.01, 5.0)]);
    expect(answer.scope).toBe("widened");
    expect(answer.nearest).toBeNull();
    expect(nearSavingLine(answer.cards, answer.nearest)).toBeNull();
  });

  it("reads 'right here' rather than a zero distance", () => {
    const nearest = { id: "x", name: "The Crown", borough: "Camden", cheapestPrice: 6.2, distanceKm: 0.05 };
    const top = { id: "y", name: "The Lamb", borough: "Camden", cheapestPrice: 4.9, distanceKm: 0.6 };
    expect(nearSavingLine([top], nearest)).toBe(
      "The Lamb is £1.30 a pint less than The Crown, the nearest pub with a listed price (£6.20, right here).",
    );
  });
});
