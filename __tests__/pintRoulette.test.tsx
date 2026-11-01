import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { PintRouletteCard, pintRouletteEmptyLine, pintRoulettePoolLine } from "@/components/nearme/NearPintRoulette";
import { haversineKm } from "@/lib/haversine";
import {
  PINT_ROULETTE_WALK_MINUTES,
  pintRouletteFactLine,
  pintRoulettePool,
  seededRouletteRandom,
  spinPintRoulette,
  type PintRouletteFact,
  type PintRoulettePoint,
} from "@/lib/pintRoulette";
import { historicAgeLabel, pintRouletteFacts } from "@/lib/pintRouletteFacts.server";
import { walkMinutesFromKm } from "@/lib/walkMinutes";

// Pint roulette (launch review D2): one random pub with a listed pint within a
// 15 minute walk, under the reader's fair pint, and one dry line from stored
// facts only.

const here = { lat: 51.5074, lng: -0.1278 };

function pub(id: string, dLat: number, overrides: Partial<PintRoulettePoint> = {}): PintRoulettePoint {
  return {
    id,
    name: `The ${id}`,
    lat: here.lat + dLat,
    lng: here.lng,
    borough: "Westminster",
    cheapestPrice: 5,
    priceSource: "Pint Prices",
    priceObservedAt: "2026-10-02",
    ...overrides,
  };
}

function minutesTo(point: PintRoulettePoint): number {
  return walkMinutesFromKm(haversineKm([here.lng, here.lat], [point.lng, point.lat]));
}

// 0.001 degrees of latitude is about 111 m.
const near = pub("near", 0.002);
const edge = pub("edge", 0.009);
const far = pub("far", 0.02);

describe("the wheel holds only priced pubs", () => {
  it("drops a pub with no price, no publisher or no read day", () => {
    const pool = pintRoulettePool(here.lat, here.lng, [
      near,
      pub("unpriced", 0.001, { cheapestPrice: null }),
      pub("no-source", 0.001, { priceSource: undefined }),
      pub("no-day", 0.001, { priceObservedAt: undefined }),
      pub("bad-day", 0.001, { priceObservedAt: "soon" }),
      pub("zero", 0.001, { cheapestPrice: 0 }),
    ]);
    expect(pool.map((candidate) => candidate.point.id)).toEqual(["near"]);
  });

  it("drops a venue that is not a public pub", () => {
    const pool = pintRoulettePool(here.lat, here.lng, [near, pub("bar", 0.001, { kind: "bar" })]);
    expect(pool.map((candidate) => candidate.point.id)).toEqual(["near"]);
  });
});

describe("the walk is a limit", () => {
  it("places the fixtures either side of 15 minutes", () => {
    expect(minutesTo(near)).toBeLessThanOrEqual(PINT_ROULETTE_WALK_MINUTES);
    expect(minutesTo(edge)).toBeLessThanOrEqual(PINT_ROULETTE_WALK_MINUTES);
    expect(minutesTo(far)).toBeGreaterThan(PINT_ROULETTE_WALK_MINUTES);
  });

  it("never spins a pub past the walk, whatever the seed", () => {
    for (let seed = 0; seed < 50; seed += 1) {
      const pick = spinPintRoulette(here.lat, here.lng, [near, edge, far], [], { random: seededRouletteRandom(seed) });
      expect(pick?.id).not.toBe("far");
      expect(pick!.walkMinutes).toBeLessThanOrEqual(PINT_ROULETTE_WALK_MINUTES);
    }
  });

  it("says nothing rather than widening when nothing is in the walk", () => {
    expect(spinPintRoulette(here.lat, here.lng, [far], [], { random: () => 0.5 })).toBeNull();
  });
});

describe("the price cap", () => {
  const cheap = pub("cheap", 0.001, { cheapestPrice: 4.6 });
  const dear = pub("dear", 0.002, { cheapestPrice: 6.9 });

  it("keeps only pubs at or under the reader's fair pint", () => {
    expect(pintRoulettePool(here.lat, here.lng, [cheap, dear], { priceCapGbp: 5 }).map((c) => c.point.id)).toEqual(["cheap"]);
    expect(pintRoulettePool(here.lat, here.lng, [cheap, dear], { priceCapGbp: 4.6 }).map((c) => c.point.id)).toEqual(["cheap"]);
  });

  it("caps nothing when no cap is set", () => {
    expect(pintRoulettePool(here.lat, here.lng, [cheap, dear], { priceCapGbp: null })).toHaveLength(2);
  });

  it("comes up empty under a cap nothing meets", () => {
    expect(spinPintRoulette(here.lat, here.lng, [dear], [], { random: () => 0, priceCapGbp: 5 })).toBeNull();
  });
});

describe("a seeded spin is repeatable", () => {
  const venues = [pub("a", 0.001), pub("b", 0.002), pub("c", 0.003), pub("d", 0.004), pub("e", 0.005)];

  it("lands on the same pub for the same seed, whatever order the index arrived in", () => {
    const one = spinPintRoulette(here.lat, here.lng, venues, [], { random: seededRouletteRandom(42) });
    const two = spinPintRoulette(here.lat, here.lng, [...venues].reverse(), [], { random: seededRouletteRandom(42) });
    expect(one?.id).toBe(two?.id);
  });

  it("reaches every pub on the wheel across seeds, so it is random rather than ranked", () => {
    const seen = new Set<string>();
    for (let seed = 0; seed < 200; seed += 1) {
      seen.add(spinPintRoulette(here.lat, here.lng, venues, [], { random: seededRouletteRandom(seed) })!.id);
    }
    expect([...seen].sort()).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("spins again somewhere else when it can", () => {
    for (let seed = 0; seed < 30; seed += 1) {
      const pick = spinPintRoulette(here.lat, here.lng, venues, [], { random: seededRouletteRandom(seed), excludeId: "c" });
      expect(pick?.id).not.toBe("c");
      expect(pick?.poolSize).toBe(5);
    }
    const only = spinPintRoulette(here.lat, here.lng, [venues[0]!], [], { random: () => 0.9, excludeId: "a" });
    expect(only?.id).toBe("a");
  });

  it("survives a random source at its edges", () => {
    expect(spinPintRoulette(here.lat, here.lng, venues, [], { random: () => 1 })?.id).toBe("e");
    expect(spinPintRoulette(here.lat, here.lng, venues, [], { random: () => Number.NaN })?.id).toBe("a");
  });
});

describe("the dry line is only what is stored", () => {
  it("names a grade, a dated label and a garden, in that order", () => {
    expect(pintRouletteFactLine(["x", "II", "Built 18th century"], true)).toBe("Grade II listed, built 18th century, beer garden.");
    expect(pintRouletteFactLine(["x", "II*", null], false)).toBe("Grade II* listed.");
    expect(pintRouletteFactLine(["x", null, "Founded 1520"], false)).toBe("Founded 1520.");
    expect(pintRouletteFactLine(undefined, true)).toBe("Beer garden.");
  });

  it("prints no line at all when nothing is stored", () => {
    expect(pintRouletteFactLine(undefined, false)).toBeNull();
    expect(pintRouletteFactLine(["x", null, null], false)).toBeNull();
  });

  it("refuses a grade or a date it cannot vouch for", () => {
    expect(pintRouletteFactLine(["x", "III", null], false)).toBeNull();
    expect(pintRouletteFactLine(["x", null, "Linked to 1701"], false)).toBeNull();
    expect(pintRouletteFactLine(["x", null, "A lovely old boozer"], false)).toBeNull();
  });

  it("reads the picked pub's own facts, never a neighbour's", () => {
    const facts: PintRouletteFact[] = [["other", "I", "Founded 1520"]];
    const pick = spinPintRoulette(here.lat, here.lng, [near], facts, { random: () => 0 });
    expect(pick?.factLine).toBeNull();
    const garden = spinPintRoulette(
      here.lat,
      here.lng,
      [pub("g", 0.001, { filterHints: { amenities: { beerGarden: true } } })],
      [["g", "II", null]],
      { random: () => 0 },
    );
    expect(garden?.factLine).toBe("Grade II listed, beer garden.");
  });
});

describe("the server facts (stored data only)", () => {
  it("keeps a historic date only when it is evidence of age", () => {
    expect(historicAgeLabel({ era: "1846", dateLabel: "Built 1846", sourced: true })).toBe("Built 1846");
    expect(historicAgeLabel({ era: null, dateLabel: "Linked to 1701", sourced: true })).toBeNull();
  });

  it("joins grades and dates onto priced pubs only", async () => {
    const facts = await pintRouletteFacts(
      [
        { id: "priced", cheapestPrice: 5 },
        { id: "unpriced", cheapestPrice: null },
        { id: "plain", cheapestPrice: 4 },
      ],
      [
        { venueId: "priced", era: "1846", dateLabel: "Built 1846", sourced: true } as never,
        { venueId: "unpriced", era: "1520", dateLabel: "Founded 1520", sourced: true } as never,
      ],
      async (id) => (id === "priced" || id === "unpriced" ? "II" : null),
    );
    expect(facts).toEqual([["priced", "II", "Built 1846"]]);
  });
});

describe("the card", () => {
  const pick = {
    id: "venue-abc",
    name: "The Harp",
    borough: "Westminster",
    priceGbp: 4.8,
    publisher: "Pint Prices",
    observedAt: "2026-10-02",
    walkMinutes: 7,
    factLine: "Grade II listed.",
    poolSize: 12,
  };

  it("says it is random, and prints the price with its source and day, the walk and the line", () => {
    const html = renderToStaticMarkup(
      <PintRouletteCard pick={pick} origin={{ lat: 0, lng: 0, fromReader: true }} cap={5} onSpinAgain={() => {}} />,
    );
    expect(html).toContain("Picked at random from one of 12 pubs with a listed pint at £5.00 or less within 15 minutes&#x27; walk.");
    expect(html).toContain("The Harp");
    expect(html).toContain("£4.80");
    expect(html).toContain("On record · Pint Prices · read 2 Oct");
    expect(html).toContain("7 min walk");
    expect(html).toContain("Grade II listed.");
    expect(html).toContain("Spin again");
    // The link and the share both open the pub on the map.
    expect(html).toContain('href="/map?sel=venue-abc"');
    expect(html).toContain("Share this pint");
  });

  it("names central London as the walk's start when the reader gave no location", () => {
    const html = renderToStaticMarkup(
      <PintRouletteCard pick={{ ...pick, poolSize: 1, factLine: null }} origin={{ lat: 0, lng: 0, fromReader: false }} cap={null} onSpinAgain={() => {}} />,
    );
    expect(html).toContain("7 min walk from central London");
    expect(html).toContain("Picked at random from the only pub with a listed pint within 15 minutes&#x27; walk.");
    expect(html).not.toContain("Spin again");
    expect(html).not.toContain("Grade");
  });

  it("words the empty wheel and the pool honestly", () => {
    expect(pintRouletteEmptyLine(null, true)).toBe(
      "The wheel came up empty. No pub with a listed pint within 15 minutes' walk of you.",
    );
    expect(pintRouletteEmptyLine(6, false)).toContain("at £6.00 or less within 15 minutes' walk of central London");
    expect(pintRoulettePoolLine({ ...pick, poolSize: 3 }, null)).toBe(
      "Picked at random from one of 3 pubs with a listed pint within 15 minutes' walk.",
    );
  });
});
