import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import dataset from "@/evals/pal/fail-closed-heritage.json";
import { offlineFetch } from "@/evals/pal/offlineFetch";
import { runAsk } from "@/lib/ask/runAsk";
import { runAskTool } from "@/lib/ask/tools";
import { retrieveHeritageWithStatus } from "@/lib/heritage";
import { GET } from "@/app/api/heritage/route";

beforeEach(() => {
  vi.stubEnv("ANTHROPIC_API_KEY", "");
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
  it.each([
    { query: "Tell me about The Blackfriar's history", expectedIds: ["venue-eltcmh"] },
    { query: "Is The Blackfriar a listed building?", expectedIds: ["venue-eltcmh"] },
    { query: "Tell me about The Blackfriar Arms's history", expectedIds: [] },
    { query: "Is The Blackfriar Arms a listed building?", expectedIds: [] },
  ])("preserves the complete subject in the approved question forms: $query", async ({ query, expectedIds }) => {
    const response = await runAsk({
      query, cityId: "london", skipModel: true, fetchImpl: offlineFetch,
    });
    expect(response.toolsUsed).toContain("venue_heritage");
    expect(response.cards.map((card) => card.venueId)).toEqual(expectedIds);
    expect(response.proposals.map((proposal) => proposal.kind === "open_venue" ? proposal.venueId : null)).toEqual(expectedIds);
    const tool = await runAskTool("venue_heritage", { venueId: "venue-eltcmh", venueName: "The Blackfriar" }, {
      query, cityId: "london", skipModel: true, fetchImpl: offlineFetch,
    });
    expect(tool.cards.map((card) => card.venueId)).toEqual(expectedIds);
    if (expectedIds.length === 0) {
      expect(response.sources).toEqual([]);
      expect(tool.provenance).toEqual([]);
    }
  });

  it.each([
    ...[
      { venueName: "The Blackfriar" },
      { name: "The Blackfriar" },
      { venueId: "venue-eltcmh" },
      { venueId: "venue-eltcmh", venueName: "The Blackfriar Arms" },
    ].flatMap((args) => [
      { query: "Tell me the history of The Blackfriar Arms.", args, expectedIds: [], ambiguous: false },
      { query: "Tell me the history of The Blackfriar Arms and The Clachan.", args, expectedIds: [], ambiguous: false },
    ]),
    ...[{}, { venueName: "The Blackfriar" }, { venueId: "venue-eltcmh" }].map((args) => ({
      query: "Tell me the history of The Blackfriar.", args, expectedIds: ["venue-eltcmh"], ambiguous: false,
    })),
    ...[{}, { venueName: "The Lamb" }, { venueId: "venue-1yd70c7" }, { venueId: "venue-uov7ku" }].map((args) => ({
      query: "Tell me the heritage of The Lamb", args, expectedIds: [], ambiguous: true,
    })),
    ...[
      "The Blackfriar Arms and The Clachan",
      "The Clachan and The Blackfriar Arms",
      "The Blackfriar Arms and The Clachan and The Imaginary Copper Narwhal",
    ].flatMap((subject) => [
      {}, { venueName: "The Clachan" }, { venueId: "venue-4pqtn7" },
    ].map((args) => ({
      query: `Tell me the history of ${subject}.`, args, expectedIds: ["venue-4pqtn7"], ambiguous: false,
    }))),
    { query: "Tell me the history of The Clachan.", args: { venueName: "The Imaginary Copper Narwhal" }, expectedIds: [], ambiguous: false },
    { query: "Tell me the history of The Clachan.", args: { venueId: "venue-unknown" }, expectedIds: [], ambiguous: false },
    { query: "Tell me the history of The Lamb and The Clachan.", args: {}, expectedIds: ["venue-4pqtn7"], ambiguous: true },
    { query: "Tell me the history of The Clachan and The Lamb.", args: {}, expectedIds: ["venue-4pqtn7"], ambiguous: true },
    { query: "Tell me the history of The Lamb and The Clachan.", args: { venueId: "venue-1yd70c7" }, expectedIds: [], ambiguous: true },
    { query: "Tell me the history of The Blackfriar and The Clachan.", args: {}, expectedIds: ["venue-eltcmh", "venue-4pqtn7"], ambiguous: false },
  ])("resolves each question subject before model arguments: %j", async ({ query, args, expectedIds, ambiguous }) => {
    const result = await runAskTool("venue_heritage", args, {
      query, cityId: "london", skipModel: true, fetchImpl: offlineFetch,
    });
    expect(result.ok).toBe(expectedIds.length > 0);
    expect(result.cards.map((card) => card.venueId)).toEqual(expectedIds);
    expect(result.proposals.map((proposal) => proposal.kind === "open_venue" ? proposal.venueId : null)).toEqual(expectedIds);
    if (expectedIds.length === 0) expect(result.provenance).toEqual([]);
    if (ambiguous) expect(result.answerHint).toContain("cannot tell which pub");
  });

  it.each([
    "The Blackfriar Arms and The Clachan",
    "The Clachan and The Blackfriar Arms",
    "The Lamb and The Clachan",
    "The Clachan and The Lamb",
  ])("keeps the valid sibling through the keyless Ask path: %s", async (subject) => {
    const result = await runAsk({
      query: `Tell me the history of ${subject}.`, cityId: "london", skipModel: true, fetchImpl: offlineFetch,
    });
    expect(result.cards.map((card) => card.venueId)).toEqual(["venue-4pqtn7"]);
    expect(result.proposals).toContainEqual(expect.objectContaining({ kind: "open_venue", venueId: "venue-4pqtn7" }));
    if (subject.includes("The Lamb")) expect(result.answer).toContain("cannot tell which pub");
  });

  it.each([
    { venueName: "The Blackfriar" },
    { venueId: "venue-eltcmh" },
  ])("rejects an unrelated model identity in a compound question: %j", async (args) => {
    const result = await runAskTool("venue_heritage", args, {
      query: "Tell me the history of The Old Bank of England and The Clachan.",
      cityId: "london", skipModel: true, fetchImpl: offlineFetch,
    });
    expect(result.cards).toEqual([]);
    expect(result.proposals).toEqual([]);
    expect(result.provenance).toEqual([]);
  });

  it("preserves a pub name containing a conjunction in a compound question", async () => {
    const result = await runAskTool("venue_heritage", { venueName: "Lion & Unicorn" }, {
      query: "Tell me the history of Lion & Unicorn and The Clachan.",
      cityId: "london", skipModel: true, fetchImpl: offlineFetch,
    });
    expect(result.cards).toHaveLength(1);
    expect(result.cards[0]?.title).toBe("Lion & Unicorn");
  });

  it("preserves the named pub when the reader also requests price sources", async () => {
    const result = await runAskTool("venue_heritage", { venueName: "The Clachan" }, {
      query: "Tell me the history of The Clachan. Show the source and date for any price you use.",
      cityId: "london", skipModel: true, fetchImpl: offlineFetch,
    });
    expect(result.cards[0]).toMatchObject({ venueId: "venue-4pqtn7", title: "The Clachan" });
  });

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

  it.each([
    "Heritage story for The Old Bank of England",
    "Tell me the history of The Old Bank of England.",
  ])("resolves the listed Old Bank for %s", async (query) => {
    const result = await runAsk({
      query, cityId: "london", skipModel: true, fetchImpl: offlineFetch,
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
  ].flatMap((venue) => [
    { ...venue, args: { venueName: venue.name } },
    { ...venue, args: { venueId: venue.id } },
  ]))("preserves $name as the tool subject in a compound heritage story question", async ({ name, id, args }) => {
    const result = await runAskTool("venue_heritage", args, {
      query: "Heritage story for The Old Bank of England and The Clachan",
      cityId: "london", skipModel: true, fetchImpl: offlineFetch,
    });
    expect(result.cards).toHaveLength(1);
    expect(result.cards[0]).toMatchObject({ venueId: id, title: name, price: null });
  });

  it("asks which Lamb the unqualified question means", async () => {
    const result = await runAsk({
      query: "Tell me the heritage of The Lamb", cityId: "london", skipModel: true, fetchImpl: offlineFetch,
    });
    expect(result.cards).toEqual([]);
    expect(result.proposals).toEqual([]);
    expect(result.sources).toEqual([]);
    expect(result.answer).toContain("cannot tell which pub");
  });

  it.each([
    { venueId: "venue-1yd70c7", hasBloomsbury: true },
    { venueId: "venue-uov7ku", hasBloomsbury: false },
    { venueId: undefined, hasBloomsbury: false },
  ])("keeps Lamb facts and sources tied to $venueId at the shared retrieval boundary", async ({ venueId, hasBloomsbury }) => {
    const input = { venueId, venueName: "The Lamb" };
    const direct = await retrieveHeritageWithStatus(input);
    const query = new URLSearchParams({ venueName: "The Lamb", ...(venueId ? { venueId } : {}) });
    const response = await GET(new Request(`http://localhost/api/heritage?${query}`));
    expect(response.status).toBe(200);
    const body = await response.json();
    for (const facts of [direct.facts, body.facts]) {
      if (hasBloomsbury) {
        expect(facts).toContainEqual(expect.objectContaining({
          fact: "The Lamb is a Grade II listed public house on Lamb's Conduit Street, Bloomsbury, noted for its surviving Victorian snob screens above the bar.",
          sourceRef: "https://en.wikipedia.org/wiki/The_Lamb,_Bloomsbury",
        }));
      } else {
        expect(facts).toEqual([]);
      }
    }
  });

  it.each([
    { venueId: "venue-fudfew", venueName: "Black Lion", expected: "pub in Hammersmith, London" },
    { venueId: "venue-1embrnu", venueName: "Black Lion", expected: null },
    { venueId: "venue-s68ndf", venueName: "Green Man", expected: null },
    { venueId: "venue-xwic8m", venueName: "Green Man", expected: null },
  ])("keeps facts and sources attached to the verified address for $venueId", async ({ venueId, venueName, expected }) => {
    const direct = await retrieveHeritageWithStatus({ venueId, venueName });
    const query = new URLSearchParams({ venueId, venueName });
    const response = await GET(new Request(`http://localhost/api/heritage?${query}`));
    expect(response.status).toBe(200);
    const body = await response.json();
    for (const facts of [direct.facts, body.facts]) {
      expect(facts.some((fact: { sourceRef?: string }) =>
        fact.sourceRef === "https://en.wikipedia.org/wiki/Black_Lion,_Kilburn" ||
        fact.sourceRef === "https://en.wikipedia.org/wiki/Green_Man,_Blackheath",
      )).toBe(false);
      expect(facts.some((fact: { fact: string }) =>
        fact.fact === "pub in Kilburn, London" || fact.fact === "demolished pub in Blackheath, London, England",
      )).toBe(false);
      if (expected) {
        expect(facts).toContainEqual({ source: "wikidata", fact: expected,
          sourceRef: "https://en.wikipedia.org/wiki/Black_Lion,_Hammersmith" });
      }
    }
    const answer = await runAskTool("venue_heritage", { venueId, venueName }, {
      query: `Tell me the history of ${venueName}.`, cityId: "london", skipModel: true, fetchImpl: offlineFetch,
    });
    expect(answer.provenance.some((source) =>
      source.url === "https://en.wikipedia.org/wiki/Black_Lion,_Kilburn" ||
      source.url === "https://en.wikipedia.org/wiki/Green_Man,_Blackheath",
    )).toBe(false);
    expect(answer.cards[0]?.note ?? "").not.toContain("pub in Kilburn, London");
    expect(answer.cards[0]?.note ?? "").not.toContain("demolished pub in Blackheath");
    expect(answer.cards).toEqual([]);
    expect(answer.answerHint).toContain("cannot tell which pub");
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
