import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import dataset from "@/evals/pal/fail-closed-prices.json";
import { gradePalCase } from "@/evals/pal/grade";
import { offlineFetch } from "@/evals/pal/offlineFetch";
import type { PalEvalAnswerExpectations } from "@/evals/pal/types";
import { loadPalEvalVenueIndex } from "@/evals/pal/venueIndex";
import { runAsk } from "@/lib/ask/runAsk";
import { runAskTool } from "@/lib/ask/tools";
import { __resetPintDrops, addPintDrop, type PintDrop } from "@/lib/pintDrops";
import * as pintDropStore from "@/lib/pintDropsStore";
import type { UkPriceBundleRow } from "@/lib/ukPriceBundle";
import * as ukPriceBundle from "@/lib/ukPriceBundle.server";

const now = Date.parse(dataset.now);
const index = loadPalEvalVenueIndex();
const zoneOne = { priceGbp: 6.25, zone: 1, sampleSize: 360 };
const zoneTwo = { priceGbp: 5.75, zone: 2, sampleSize: 301 };
const zoneThree = { priceGbp: 5.4, zone: 3, sampleSize: 142 };
const recordedZoneMedians: Record<string, typeof zoneOne> = {
  "venue-60y3sa": zoneTwo,
  "venue-10paqy": zoneThree,
  "venue-ru7vbr": zoneOne,
  "venue-4pqtn7": zoneOne,
  "venue-on4bgj": zoneTwo,
  "venue-f1vl09": zoneTwo,
  "venue-1kt3p9o": zoneOne,
  "venue-1wgngrf": zoneOne,
  "venue-14mrz2z": zoneOne,
  "venue-4zg2be": zoneTwo,
};

function ask(query: string) {
  return runAsk({ query, cityId: "london", now, skipModel: true, fetchImpl: offlineFetch });
}

function reference(caseDef: typeof dataset.cases[number]): PalEvalAnswerExpectations {
  if (caseDef.value === null) {
    return { priceAnswer: { venueId: caseDef.venueId, value: null, estimateGbp: recordedZoneMedians[caseDef.venueId]!.priceGbp } };
  }
  if (!caseDef.source) throw new Error(`Missing price source for ${caseDef.id}`);
  return { priceAnswer: { venueId: caseDef.venueId, value: caseDef.value, source: caseDef.source } };
}

beforeEach(() => {
  __resetPintDrops();
  vi.stubEnv("ANTHROPIC_API_KEY", "");
  vi.stubEnv("TYPESAFE_API_KEY", "");
  vi.stubGlobal("fetch", vi.fn(() => {
    throw new Error("The fail-closed price eval must stay offline.");
  }));
});

afterEach(() => {
  __resetPintDrops();
  expect(fetch).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("Pal fail-closed price eval", () => {
  it("pins ten unknown prices and two sourced prices to the committed venue dataset", () => {
    const slim = JSON.parse(readFileSync(join(process.cwd(), "public/data/venues_slim.json"), "utf8")) as {
      rows: Array<{ id: string; cheapestPrice: number | null; priceSource?: string }>;
    };
    expect(Number.isFinite(now)).toBe(true);
    expect(new Set(dataset.cases.map((entry) => entry.id)).size).toBe(12);
    expect(new Set(dataset.cases.map((entry) => entry.venueId)).size).toBe(12);
    expect(dataset.cases.filter((entry) => entry.value === null)).toHaveLength(10);
    for (const entry of dataset.cases) {
      const venue = slim.rows.find((row) => row.id === entry.venueId);
      expect(venue, entry.id).toBeDefined();
      expect(venue?.cheapestPrice, entry.id).toBe(entry.value);
      if (entry.value !== null) expect(venue?.priceSource, entry.id).toBe(entry.source);
    }
  });

  it.each(dataset.cases)("$id matches independent committed zone medians or recorded prices through runAsk", async (entry) => {
    const body = await ask(entry.query);
    // A refusal for the wrong pub must not count as a successful absence answer.
    expect(body.toolsUsed).toContain("venue_prices");
    expect(body.cards.some((card) => card.venueId === entry.venueId)).toBe(true);
    if (entry.value === null) {
      const expected = recordedZoneMedians[entry.venueId]!;
      expect(body.answer).toContain(`Estimate £${expected.priceGbp.toFixed(2)}`);
      expect(body.answer).toContain(`middle of ${expected.sampleSize} recorded pint prices in Zone ${expected.zone}`);
    }
    const outcome = gradePalCase(body, reference(entry), index);
    expect(outcome.checks.filter((check) => !check.pass)).toEqual([]);
  });

  it("answers with a bundle listing when the slim pint price is empty", async () => {
    const body = await runAskTool("venue_prices", { venueId: "venue-10x17k9" }, {
      cityId: "london", query: "", now, skipModel: true, fetchImpl: offlineFetch,
    });
    const card = body.cards.find((card) => card.venueId === "venue-10x17k9");
    expect(card?.price).toBe(6.45);
    expect(card?.provenance?.label).toContain("Guinndex");
    expect(body.answerHint).toContain("listed pint £6.45");
    expect(body.data).toMatchObject({ zoneEstimate: null });
  });

  it.each([
    { visibility: "public", status: "visible", priceGbp: 5.8, estimates: false },
    { visibility: "anonymous", status: "visible", priceGbp: 5.8, estimates: false },
    { visibility: "public", status: "visible", priceGbp: null, estimates: true },
    { visibility: "friends", status: "visible", priceGbp: 5.8, estimates: true },
    { visibility: "legacy", status: "visible", priceGbp: 5.8, estimates: true },
    { visibility: "public", status: "hidden", priceGbp: 5.8, estimates: true },
  ] satisfies Array<Pick<PintDrop, "visibility" | "status" | "priceGbp"> & { estimates: boolean }>)(
    "public price absence with $visibility, $status and £$priceGbp permits estimates=$estimates",
    async ({ visibility, status, priceGbp, estimates }) => {
      addPintDrop({
        id: "coronet-price-regression", venueId: "venue-60y3sa", handle: "price-reader",
        drink: "Lager", measure: "pint", priceGbp, passedDownNote: "", era: "",
        provenance: "contributor", status, visibility, createdAt: new Date(now).toISOString(),
      });
      const result = await runAskTool("venue_prices", { venueId: "venue-60y3sa" }, {
        cityId: "london", query: "How much is a pint at The Coronet?", now, skipModel: true,
      });
      expect(result.data).toMatchObject({
        curatedPrice: null,
        zoneEstimate: estimates ? { estimateGbp: 5.75, zone: 2, sampleSize: 301 } : null,
      });
      expect(result.degraded).toBe(false);
      const body = await ask("How much is a pint at The Coronet?");
      expect(body.toolsUsed).toContain("venue_prices");
      expect(body.cards.find((card) => card.venueId === "venue-60y3sa")?.price).toBeNull();
      if (estimates) {
        expect(body.answer).toContain("Estimate £5.75");
      } else {
        expect(body.answer).not.toContain("£5.75");
        expect(body.answer).toContain("no listed figure");
        expect(body.cards.find((card) => card.venueId === "venue-60y3sa")?.note).not.toContain("No recorded pint.");
        expect(body.cards.find((card) => card.venueId === "venue-60y3sa")?.note).not.toContain("£5.75");
        expect(result.priceEvidence).toEqual([]);
      }
    },
  );

  it.each(["factory", "read"])("withholds estimates when the Pint Drop %s is unavailable", async (failure) => {
    if (failure === "factory") {
      vi.spyOn(pintDropStore, "pintDropsStore").mockImplementation(() => { throw new Error("Store unavailable"); });
    } else {
      vi.spyOn(pintDropStore.memoryPintDropStore, "listVisible").mockRejectedValue(new Error("Read failed"));
    }
    const result = await runAskTool("venue_prices", { venueId: "venue-60y3sa" }, {
      cityId: "london", query: "How much is a pint at The Coronet?", now, skipModel: true,
    });
    expect(result.data).toMatchObject({ curatedPrice: null, zoneEstimate: null });
    expect(result.degraded).toBe(true);
    expect(result.cards[0]?.note).toContain("couldn't read all recorded pint prices");
    const body = await ask("How much is a pint at The Coronet?");
    expect(body.status).toBe("degraded");
    expect(body.answer).toContain("recorded pint prices are unavailable");
    expect(body.answer).not.toContain("£5.70");
    expect(body.cards[0]?.price).toBeNull();
  });

  it("keeps the Brownswood's recorded £5.30 pint instead of its £2.60 half-pint mixer", async () => {
    const body = await ask("How much is a pint at The Brownswood?");
    expect(body.toolsUsed).toContain("venue_prices");
    expect(body.cards.find((card) => card.venueId === "venue-1vse4lh")?.price).toBe(5.3);
    expect(body.answer).toContain("listed pint £5.30");
    expect(body.answer).not.toContain("£2.60");
  });

  it.each([
    { drinkLabel: "~ 1/2 pint Tonic, Slim Tonic, Ginger Ale / Beer-", servingSize: undefined, expected: 5.3 },
    { drinkLabel: "Lager", servingSize: "half pint", expected: 5.3 },
    { drinkLabel: "Bottled lager", servingSize: "568ml", expected: 5.3 },
    { drinkLabel: "Lager", servingSize: "330ml", expected: 5.3 },
    { drinkLabel: "Lager half", servingSize: "568ml", expected: 5.3 },
    { drinkLabel: "Lager", servingSize: "pint", expected: 2.6 },
    { drinkLabel: "Lager", servingSize: "568ml", expected: 2.6 },
    { drinkLabel: undefined, servingSize: undefined, expected: 2.6 },
  ])("uses £$expected for bundle label $drinkLabel and serving $servingSize", async ({ drinkLabel, servingSize, expected }) => {
    const row: UkPriceBundleRow = {
      venueId: "venue-1vse4lh", name: "The Brownswood", category: "beer", priceGbp: 2.6,
      lane: "site-harvest", standing: "listed", sourceUrl: "https://thebrownswood.co.uk/drinks-menu/",
      publisher: "thebrownswood.co.uk", observedAt: "2026-09-21", basis: null, sampleSize: null,
      drinkLabel, servingSize,
    };
    vi.spyOn(ukPriceBundle, "ukPriceBundleRowsFor").mockResolvedValue({ status: "ready", rows: [row] });
    const body = await runAskTool("venue_prices", { venueId: row.venueId }, {
      cityId: "london", query: "How much is a pint at The Brownswood?", now, skipModel: true, fetchImpl: offlineFetch,
    });
    expect(body.cards.find((card) => card.venueId === row.venueId)?.price).toBe(expected);
    expect(body.answerHint).toContain(`listed pint £${expected.toFixed(2)}`);
    expect(body.data).toMatchObject({ curatedPrice: expected, zoneEstimate: null });
    expect(body.priceEvidence).toMatchObject([{ kind: "listed-pint", priceGbp: expected, serving: "pint" }]);
  });

  it("rejects an invented price in the answer even when the card leaves it unknown", async () => {
    const body = await ask("How much is a pint at The Coronet?");
    const estimateGbp = recordedZoneMedians["venue-60y3sa"]!.priceGbp;
    expect(estimateGbp).toBeDefined();
    expect(body.answer).toContain("no listed pint price");
    expect(body.answer).toContain(`Estimate £${estimateGbp?.toFixed(2)}`);
    expect(body.cards.find((card) => card.venueId === "venue-60y3sa")?.price).toBeNull();

    // A figure other than the zone estimate is invented, and so is the zone
    // estimate itself once the answer stops calling it one.
    for (const answer of [
      "The Coronet: no listed pint price. Estimate £4.50.",
      `The Coronet: no listed pint price. A pint costs £${estimateGbp?.toFixed(2)}.`,
    ]) {
      const outcome = gradePalCase({ ...body, answer }, {
        priceAnswer: { venueId: "venue-60y3sa", value: null, estimateGbp },
      }, index);
      expect(outcome.pass, answer).toBe(false);
    }
  });

  it.each(["£5.70", "GBP 5.70", "5.70 pounds", "570p", "5.70"])(
    "requires an estimate label beside every %s claim in each text field",
    async (amount) => {
      const body = await ask("How much is a pint at The Coronet?");
      const expected = { priceAnswer: { venueId: "venue-60y3sa", value: null, estimateGbp: 5.7 } };
      for (const claim of [
        `I cannot estimate it. A pint costs ${amount}.`,
        `Estimate ${amount}. A pint costs ${amount}.`,
        `I cannot estimate ${amount}.`,
      ]) {
        const responses = [
          { ...body, answer: `The Coronet: no listed pint price. ${claim}` },
          { ...body, cards: body.cards.map((card) => ({ ...card, title: claim })) },
          { ...body, cards: body.cards.map((card) => ({ ...card, note: claim })) },
        ];
        for (const response of responses) {
          const outcome = gradePalCase(response, expected, index);
          expect(outcome.checks, claim).toContainEqual(expect.objectContaining({ name: "unknown_price_empty", pass: false }));
        }
      }
      const labelled = `Estimate: ${amount}.`;
      expect(gradePalCase({
        ...body,
        answer: `The Coronet: no listed pint price. ${labelled}`,
        cards: body.cards.map((card) => ({ ...card, note: labelled })),
      }, expected, index).pass).toBe(true);
    },
  );

  it.each(["£4.50", "GBP 4.50", "4.50 pounds", "450p", "4.50"])(
    "rejects the numeric price form %s even beside an absence disclaimer",
    async (amount) => {
      const body = await ask("How much is a pint at The Coronet?");
      const outcome = gradePalCase({ ...body, answer: `The price is unknown, but expect ${amount}.` }, {
        priceAnswer: { venueId: "venue-60y3sa", value: null },
      }, index);
      expect(outcome.checks).toContainEqual(expect.objectContaining({ name: "unknown_price_empty", pass: false }));
    },
  );

  it.each([
    "The opening hours are unknown.",
    "The price at The Coronet is listed and the opening hours are unknown.",
    "No pint is available.",
    "There is no listed figure for opening hours.",
    "The opening hours are not known.",
    "The heritage is not recorded.",
    ...["cannot", "can't", "do not", "don't"].flatMap((inability) =>
      ["confirm", "verify", "provide", "know"].map((verb) => `I ${inability} ${verb} the opening hours.`)),
    "The price is listed, but the opening hours are unknown.",
    "I cannot confirm the opening hours. The price is listed.",
    ...["unknown", "not known", "not recorded", "not available", "unavailable"].map((absence) =>
      `The price is listed, but the opening hours are ${absence}.`),
    "No prices are missing.",
    "No prices are unknown.",
    "No prices are not recorded.",
    "The price is not unknown.",
    "The price is not unavailable.",
    "The price for The Coronet is not unknown.",
    "The price for The Coronet not unknown.",
    "The price at The Coronet is listed and the heritage is unknown.",
    "The price is listed and the opening hours are not recorded.",
  ])("rejects an unrelated absence statement: %s", async (answer) => {
    const body = await ask("How much is a pint at The Coronet?");
    const outcome = gradePalCase({ ...body, answer }, {
      priceAnswer: { venueId: "venue-60y3sa", value: null },
    }, index);
    expect(outcome.pass).toBe(false);
    expect(outcome.checks).toContainEqual(expect.objectContaining({ name: "unknown_price_disclosed", pass: false }));
  });

  it.each([
    "The price is unknown.",
    "The pint price at The Coronet is not known.",
    "The price for The Coronet is not recorded.",
    "No current recorded pint price is available.",
    ...["unknown", "not known", "not recorded", "not available", "unavailable"].flatMap((absence) => [
      `The price at The Coronet is ${absence}.`,
      `${absence} price.`,
    ]),
    "The opening hours are listed, but the price is unknown.",
    "I cannot confirm the current price.",
    "I cannot provide a recorded price.",
    ...["cannot", "can't", "do not", "don't"].flatMap((inability) =>
      ["confirm", "verify", "provide", "know"].map((verb) => `I ${inability} ${verb} the price.`)),
  ])("accepts a price absence statement: %s", async (answer) => {
    const body = await ask("How much is a pint at The Coronet?");
    expect(gradePalCase({ ...body, answer }, {
      priceAnswer: { venueId: "venue-60y3sa", value: null },
    }, index).pass).toBe(true);
  });

  it("rejects silence about the unknown price", async () => {
    const body = await ask("How much is a pint at The Coronet?");
    const outcome = gradePalCase({ ...body, answer: "The Coronet is in Islington." }, {
      priceAnswer: { venueId: "venue-60y3sa", value: null },
    }, index);
    expect(outcome.checks).toContainEqual(expect.objectContaining({ name: "unknown_price_disclosed", pass: false }));
  });

  it("rejects a correct known price without its named source", async () => {
    const body = await ask("How much is a pint at Arnos Arms?");
    const outcome = gradePalCase({ ...body, cards: body.cards.map((card) => ({ ...card, provenance: undefined })) }, {
      priceAnswer: { venueId: "venue-xjf3n0", value: 5.5, source: "Pint Prices" },
    }, index);
    expect(outcome.checks).toContainEqual(expect.objectContaining({ name: "known_price_source", pass: false }));
  });

  it("requires the named source on the card that carries the known price", async () => {
    const body = await ask("How much is a pint at Arnos Arms?");
    const outcome = gradePalCase({ ...body, cards: body.cards.flatMap((card) => [
      { ...card, provenance: undefined },
      { ...card, key: `${card.key}-unpriced`, price: null },
    ]) }, {
      priceAnswer: { venueId: "venue-xjf3n0", value: 5.5, source: "Pint Prices" },
    }, index);
    expect(outcome.checks).toContainEqual(expect.objectContaining({ name: "known_price_source", pass: false }));
  });

  it("rejects a missing known price even when the answer repeats the right amount", async () => {
    const body = await ask("How much is a pint at Arnos Arms?");
    const outcome = gradePalCase({ ...body, cards: [] }, {
      priceAnswer: { venueId: "venue-xjf3n0", value: 5.5, source: "Pint Prices" },
    }, index);
    expect(outcome.checks).toContainEqual(expect.objectContaining({ name: "known_price_value", pass: false }));
  });

  it("rejects a different price in the answer beside the known price", async () => {
    const body = await ask("How much is a pint at Arnos Arms?");
    const outcome = gradePalCase({ ...body, answer: `${body.answer} Expect £6.50 tonight.` }, {
      priceAnswer: { venueId: "venue-xjf3n0", value: 5.5, source: "Pint Prices" },
    }, index);
    expect(outcome.checks).toContainEqual(expect.objectContaining({ name: "known_price_value", pass: false }));
  });
});
