import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import dataset from "@/evals/pal/fail-closed-heritage.json";
import { offlineFetch } from "@/evals/pal/offlineFetch";
import { runAsk } from "@/lib/ask/runAsk";
import { runAskTool } from "@/lib/ask/tools";

beforeEach(() => {
  vi.stubEnv("OPENROUTER_API_KEY", "");
  vi.stubEnv("TYPESAFE_API_KEY", "");
  vi.stubGlobal("fetch", vi.fn(() => {
    throw new Error("Heritage question tests must stay offline.");
  }));
});

afterEach(() => {
  expect(fetch).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("typed heritage questions", () => {
  it.each(["The Imaginary Copper Narwhal", "The Blackfriar Arms"])("does not turn unlisted %s into a venue card", async (name) => {
    const response = await runAsk({
      query: `Tell me the history of ${name}.`,
      cityId: "london",
      skipModel: true,
      fetchImpl: offlineFetch,
    });
    expect(response.cards).toEqual([]);
    expect(response.proposals).toEqual([]);
    expect(response.sources).toEqual([]);
    expect(response.answer).toContain("Name a listed pub");
  });

  it("preserves each exact tool subject when the question names two pubs", async () => {
    const result = await runAskTool("venue_heritage", { venueName: "The Clachan" }, {
      query: "Tell me the history of The Blackfriar and The Clachan.",
      cityId: "london",
      skipModel: true,
      fetchImpl: offlineFetch,
    });
    expect(result.cards).toHaveLength(1);
    expect(result.cards[0]).toMatchObject({ venueId: "venue-4pqtn7", title: "The Clachan" });
  });

  it("resolves a complete name without its leading article", async () => {
    const result = await runAsk({
      query: "Tell me the history of Clachan.", cityId: "london", skipModel: true, fetchImpl: offlineFetch,
    });
    expect(result.cards[0]).toMatchObject({ venueId: "venue-4pqtn7", title: "The Clachan" });
  });

  it("resolves the listed Old Bank in a heritage story request", async () => {
    const result = await runAsk({
      query: "Heritage story for The Old Bank of England", cityId: "london", skipModel: true, fetchImpl: offlineFetch,
    });
    expect(result.toolsUsed).toContain("venue_heritage");
    expect(result.cards).toHaveLength(1);
    expect(result.cards[0]).toMatchObject({ venueId: "venue-lrlyh8", title: "The Old Bank of England", price: null });
    expect(result.proposals).toContainEqual(expect.objectContaining({ kind: "open_venue", venueId: "venue-lrlyh8" }));
  });

  it("does not shorten an unlisted name in a heritage story request", async () => {
    const result = await runAsk({
      query: "Heritage story for The Old Bank of England Arms", cityId: "london", skipModel: true, fetchImpl: offlineFetch,
    });
    expect(result.cards).toEqual([]);
    expect(result.proposals).toEqual([]);
    expect(result.sources).toEqual([]);
  });

  it.each([
    { name: "The Old Bank of England", id: "venue-lrlyh8" },
    { name: "The Clachan", id: "venue-4pqtn7" },
  ])("preserves $name as the tool subject in a compound heritage story question", async ({ name, id }) => {
    const result = await runAskTool("venue_heritage", { venueName: name }, {
      query: "Heritage story for The Old Bank of England and The Clachan",
      cityId: "london", skipModel: true, fetchImpl: offlineFetch,
    });
    expect(result.cards).toHaveLength(1);
    expect(result.cards[0]).toMatchObject({ venueId: id, title: name, price: null });
  });

  it("does not choose the first of several pubs with the same name", async () => {
    const result = await runAsk({
      query: "Tell me the history of The Crown.", cityId: "london", skipModel: true, fetchImpl: offlineFetch,
    });
    expect(result.cards).toEqual([]);
    expect(result.proposals).toEqual([]);
    expect(result.sources).toEqual([]);
  });

  it("does not use an apostrophe to choose between unresolved duplicate records", async () => {
    const result = await runAsk({
      query: "Tell me the history of The Miller's Well.", cityId: "london", skipModel: true, fetchImpl: offlineFetch,
    });
    expect(result.cards).toEqual([]);
    expect(result.proposals).toEqual([]);
    expect(result.sources).toEqual([]);
    expect(result.answer).toContain("cannot tell which pub");
  });

  it.each(dataset.cases)("answers $venueName without guessing its identity", async (entry) => {
    const response = await runAsk({
      query: entry.query,
      cityId: "london",
      skipModel: true,
      now: Date.parse(dataset.now),
      fetchImpl: offlineFetch,
    });

    expect(response.toolsUsed).toContain("venue_heritage");
    // The source corpus identifies a record, not a unique name. The separate
    // Miller's Well record has no canonical alias joining these two IDs.
    if (entry.venueId === "venue-10paqy") {
      expect(response.cards).toEqual([]);
      expect(response.proposals).toEqual([]);
      expect(response.sources).toEqual([]);
      expect(response.answer).toContain("cannot tell which pub");
      return;
    }
    expect(response.cards).toHaveLength(1);
    expect(response.cards[0]).toMatchObject({
      venueId: entry.venueId,
      title: entry.venueName,
      price: null,
    });
    expect(response.proposals).toContainEqual(expect.objectContaining({
      kind: "open_venue",
      venueId: entry.venueId,
    }));
    if (entry.facts.length === 0) {
      expect(response.cards[0]?.note).toContain("no fuller story on record");
      expect(response.sources).toEqual([]);
    } else {
      for (const fact of entry.facts) {
        expect(response.cards[0]?.note).toContain(fact.fact);
        expect(response.sources).toContainEqual(expect.objectContaining({
          label: fact.source,
          url: fact.sourceUrl,
        }));
      }
    }
  });
});
