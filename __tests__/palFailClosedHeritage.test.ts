import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import dataset from "@/evals/pal/fail-closed-heritage.json";
import type { PalEvalAnswerExpectations } from "@/evals/pal/types";
import { offlineFetch } from "@/evals/pal/offlineFetch";
import { runAskTool } from "@/lib/ask/tools";
import { retrieveHeritage } from "@/lib/heritage";
import { getVenueDetail } from "@/lib/venueDetailIndex";
import { gradePalCase } from "@/evals/pal/grade";
import { loadPalEvalVenueIndex } from "@/evals/pal/venueIndex";
import type { AskResponseBody } from "@/lib/ask/types";

const index = loadPalEvalVenueIndex();
const reference = {
  heritageAnswer: { venueId: "venue-60y3sa", venueName: "The Coronet", facts: [] },
};
const response: AskResponseBody = {
  answer: "The history of The Coronet is not known.",
  cards: [{ key: "coronet", venueId: "venue-60y3sa", title: "The Coronet", place: "", price: null, note: "" }],
  sources: [], proposals: [], toolsUsed: ["venue_heritage"], status: "ready",
};

const now = Date.parse(dataset.now);
const knownCase = dataset.cases.find((entry) => entry.venueName === "The Clachan")!;
function expectations(entry: typeof dataset.cases[number]): PalEvalAnswerExpectations {
  return { heritageAnswer: { venueId: entry.venueId, venueName: entry.venueName, facts: entry.facts } };
}
async function ask(entry: typeof dataset.cases[number]): Promise<AskResponseBody> {
  const result = await runAskTool("venue_heritage", { venueId: entry.venueId }, {
    query: entry.query, cityId: "london", now, skipModel: true, fetchImpl: offlineFetch,
  });
  return {
    answer: result.answerHint ?? "", cards: result.cards, sources: result.provenance,
    proposals: result.proposals, toolsUsed: [result.tool], status: result.degraded ? "degraded" : "ready",
  };
}

beforeEach(() => {
  vi.stubEnv("OPENROUTER_API_KEY", "");
  vi.stubEnv("TYPESAFE_API_KEY", "");
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("The heritage evaluator must stay offline."); }));
});
afterEach(() => {
  expect(fetch).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("Pal fail-closed heritage eval", () => {
  it("pins ten unknown histories and two sourced histories to the committed venue records", async () => {
    expect(Number.isFinite(now)).toBe(true);
    expect(new Set(dataset.cases.map((entry) => entry.id)).size).toBe(12);
    expect(new Set(dataset.cases.map((entry) => entry.venueId)).size).toBe(12);
    expect(dataset.cases.filter((entry) => !entry.facts.length)).toHaveLength(10);
    for (const entry of dataset.cases) {
      expect((await getVenueDetail(entry.venueId))?.name, entry.id).toBe(entry.venueName);
      const facts = await retrieveHeritage({ venueId: entry.venueId, venueName: entry.venueName });
      expect(facts.map((fact) => ({ fact: fact.fact, source: fact.source.toUpperCase(), sourceUrl: fact.sourceRef })), entry.id)
        .toEqual(entry.facts);
    }
  });

  it.each(dataset.cases)("$id answers through the shared tool without network access", async (entry) => {
    const result = gradePalCase(await ask(entry), expectations(entry), index);
    expect(result.checks.filter((check) => !check.pass)).toEqual([]);
  });

  it.each([
    "The history of The Coronet is not known.",
    "The heritage of The Coronet is not known.",
    "I cannot confirm the history of The Coronet.",
    "I've got the basics but no fuller story on record yet. I won't make one up.",
  ])("accepts the bounded refusal: %s", (answer) => {
    expect(gradePalCase({ ...response, answer }, reference, index).pass).toBe(true);
  });

  it.each(["Built in 1666.", "Charles Dickens drank here.", "It is Grade II listed."])(
    "rejects unsupported claims in a card: %s", (note) => {
      expect(gradePalCase({ ...response, cards: response.cards.map((card) => ({ ...card, note })) }, reference, index).pass).toBe(false);
    },
  );

  it.each(["The price is unknown.", "The Coronet is a pub."])("rejects silence about missing heritage: %s", (answer) => {
    expect(gradePalCase({ ...response, answer }, reference, index).pass).toBe(false);
  });

  it("rejects a refusal for a different pub", () => {
    expect(gradePalCase({ ...response, cards: response.cards.map((card) => ({ ...card, venueId: "venue-4pqtn7" })) }, reference, index).pass).toBe(false);
  });

  it("rejects a fabricated source for unknown heritage", () => {
    expect(gradePalCase({ ...response, sources: [{ kind: "heritage", label: "WIKIPEDIA", url: "https://example.com" }] }, reference, index).pass).toBe(false);
  });

  it("rejects an absence answer when heritage is recorded", async () => {
    const body = await ask(knownCase);
    expect(gradePalCase({ ...body, answer: response.answer }, expectations(knownCase), index).pass).toBe(false);
  });

  it.each(["Built in 1666.", "Charles Dickens drank here.", "Grade I listed public house."])(
    "rejects extra prose beside recorded facts: %s", async (claim) => {
      const body = await ask(knownCase);
      expect(gradePalCase({ ...body, answer: `${body.answer} ${claim}` }, expectations(knownCase), index).pass).toBe(false);
      expect(gradePalCase({ ...body, cards: body.cards.map((card) => ({ ...card, note: `${card.note} ${claim}` })) }, expectations(knownCase), index).pass).toBe(false);
    },
  );

  it("rejects an altered known fact", async () => {
    const body = await ask(knownCase);
    expect(gradePalCase({ ...body, cards: body.cards.map((card) => ({ ...card, note: card.note.replace("Grade II", "Grade I") })) }, expectations(knownCase), index).pass).toBe(false);
  });

  it("accepts the recorded facts in the answer as well as the card", async () => {
    const body = await ask(knownCase);
    expect(gradePalCase({ ...body, answer: knownCase.facts.map((fact) => fact.fact).join(" ") }, expectations(knownCase), index).pass).toBe(true);
  });

  it.each([undefined, { kind: "heritage" as const, label: "Invented publisher", url: "https://example.com" },
    { kind: "heritage" as const, label: "NHLE", url: "https://example.com" },
  ])("rejects missing or incorrect card provenance: %j", async (provenance) => {
    const body = await ask(knownCase);
    expect(gradePalCase({ ...body, cards: body.cards.map((card) => ({ ...card, provenance })) }, expectations(knownCase), index).pass).toBe(false);
  });

  it("requires a source for every recorded fact", async () => {
    const body = await ask(knownCase);
    expect(gradePalCase({ ...body, sources: body.sources.slice(0, 1) }, expectations(knownCase), index).pass).toBe(false);
  });

  it("requires the source on the card with the facts", async () => {
    const body = await ask(knownCase);
    expect(gradePalCase({ ...body, cards: body.cards.flatMap((card) => [
      { ...card, provenance: undefined }, { ...card, key: `${card.key}-empty`, note: "" },
    ]) }, expectations(knownCase), index).pass).toBe(false);
  });

  it("rejects invented history beside an explicit absence statement", () => {
    expect(gradePalCase({ ...response, answer: `${response.answer} Charles Dickens drank here.` }, reference, index).pass).toBe(false);
  });
});
