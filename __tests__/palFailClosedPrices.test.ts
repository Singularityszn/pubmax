import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import dataset from "@/evals/pal/fail-closed-prices.json";
import { gradePalCase } from "@/evals/pal/grade";
import { offlineFetch } from "@/evals/pal/offlineFetch";
import type { PalEvalAnswerExpectations } from "@/evals/pal/types";
import { loadPalEvalVenueIndex } from "@/evals/pal/venueIndex";
import { runAsk } from "@/lib/ask/runAsk";

const now = Date.parse(dataset.now);
const index = loadPalEvalVenueIndex();

function ask(query: string) {
  return runAsk({ query, cityId: "london", now, skipModel: true, fetchImpl: offlineFetch });
}

function reference(caseDef: typeof dataset.cases[number]): PalEvalAnswerExpectations {
  if (caseDef.value === null) return { priceAnswer: { venueId: caseDef.venueId, value: null } };
  if (!caseDef.source) throw new Error(`Missing price source for ${caseDef.id}`);
  return { priceAnswer: { venueId: caseDef.venueId, value: caseDef.value, source: caseDef.source } };
}

beforeEach(() => {
  vi.stubEnv("OPENROUTER_API_KEY", "");
  vi.stubEnv("TYPESAFE_API_KEY", "");
  vi.stubGlobal("fetch", vi.fn(() => {
    throw new Error("The fail-closed price eval must stay offline.");
  }));
});

afterEach(() => {
  expect(fetch).not.toHaveBeenCalled();
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

  it.each(dataset.cases)("$id answers honestly through runAsk without network access", async (entry) => {
    const body = await ask(entry.query);
    // A refusal for the wrong pub must not count as a successful absence answer.
    expect(body.toolsUsed).toContain("venue_prices");
    expect(body.cards.some((card) => card.venueId === entry.venueId)).toBe(true);
    const outcome = gradePalCase(body, reference(entry), index);
    expect(outcome.checks.filter((check) => !check.pass)).toEqual([]);
  });

  it("rejects an invented price in the answer even when the card leaves it unknown", async () => {
    const body = await ask("How much is a pint at The Coronet?");
    expect(body.answer).toContain("no listed figure");
    expect(body.cards.find((card) => card.venueId === "venue-60y3sa")?.price).toBeNull();

    const outcome = gradePalCase({
      ...body,
      answer: "The Coronet: a pint costs £4.50.",
    }, {
      priceAnswer: { venueId: "venue-60y3sa", value: null },
    }, index);
    expect(outcome.pass).toBe(false);
  });

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
