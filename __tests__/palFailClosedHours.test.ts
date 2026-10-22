import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { gradePalCase } from "@/evals/pal/grade";
import { offlineFetch } from "@/evals/pal/offlineFetch";
import { loadPalEvalVenueIndex } from "@/evals/pal/venueIndex";
import { runAsk } from "@/lib/ask/runAsk";
import { runAskTool } from "@/lib/ask/tools";
import type { AskResponseBody } from "@/lib/ask/types";
import { getVenueDetail } from "@/lib/venueDetailIndex";

const index = loadPalEvalVenueIndex();
const reference = { hoursAnswer: { value: null } } as const;
const response: AskResponseBody = {
  answer: "The opening hours of The Coronet are not known.",
  cards: [],
  proposals: [],
  sources: [],
  status: "ready",
  toolsUsed: [],
};

beforeEach(() => {
  vi.stubEnv("OPENROUTER_API_KEY", "");
  vi.stubEnv("TYPESAFE_API_KEY", "");
  vi.stubGlobal("fetch", vi.fn(() => {
    throw new Error("The hours evaluator must stay offline.");
  }));
});

afterEach(() => {
  expect(fetch).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("Pal unknown-hours grading", () => {
  it("answers the named pub instead of returning unrelated picks", async () => {
    const venue = await getVenueDetail("venue-60y3sa");
    expect(venue?.name).toBe("The Coronet");
    expect(venue?.openingHours).toBeUndefined();
    const body = await runAsk({
      query: "What are the opening hours of The Coronet?",
      cityId: "london",
      now: Date.parse("2026-10-22T18:00:00Z"),
      skipModel: true,
      fetchImpl: offlineFetch,
    });
    const result = gradePalCase(body, reference, index);
    expect(result.checks.filter((check) => !check.pass)).toEqual([]);
    expect(body.cards.map((card) => card.venueId)).toEqual(["venue-60y3sa"]);
    expect(gradePalCase({ ...body, answer: "Four picks from the listed pubs." }, reference, index).pass).toBe(false);
  });

  it.each([
    "Show me the opening hours of The Coronet.",
    "What are the opening times at The Coronet?",
    "What are the closing times for The Coronet?",
  ])("keeps the named hours question out of map and discovery routing: %s", async (query) => {
    const body = await runAsk({ query, skipModel: true, fetchImpl: offlineFetch });
    expect(body.cards.map((card) => card.venueId)).toEqual(["venue-60y3sa"]);
    expect(body.proposals).toEqual([]);
    expect(gradePalCase(body, reference, index).pass).toBe(true);
  });

  it("returns known regular hours with the named website and date", async () => {
    const body = await runAsk({
      query: "What are the opening hours of The Crosse Keys?",
      now: Date.parse("2026-10-22T18:00:00Z"), skipModel: true, fetchImpl: offlineFetch,
    });
    expect(body.cards).toHaveLength(1);
    expect(body.cards[0]?.venueId).toBe("venue-zottpx");
    expect(body.answer).toContain("Thursday 08:00 to 23:00");
    expect(body.answer).toContain("Holiday and one-off hours may differ.");
    expect(body.cards[0]?.provenance).toEqual({
      kind: "directory", label: "The Crosse Keys website. Checked 2026-10-05",
      url: "https://www.jdwetherspoon.com/pubs/the-crosse-keys-city-of-london",
    });
    expect(body.sources).toContainEqual(body.cards[0]?.provenance);
  });

  it("does not reuse stale hours as current hours", async () => {
    const body = await runAsk({
      query: "What are the opening hours of The Crosse Keys?",
      now: Date.parse("2030-10-22T18:00:00Z"), skipModel: true, fetchImpl: offlineFetch,
    });
    expect(gradePalCase(body, reference, index).pass).toBe(true);
    expect(body.cards[0]?.provenance).toBeUndefined();
  });

  it("asks for a pub name when no listed venue matches", async () => {
    const body = await runAsk({ query: "What are the opening hours of Imaginary Moon Tavern?", skipModel: true });
    expect(body.cards).toEqual([]);
    expect(body.answer).toContain("Which pub do you mean?");
  });

  it("answers recorded hours without a model call even when providers are configured", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-not-a-key");
    vi.stubEnv("TYPESAFE_API_KEY", "test-not-a-key");
    const transport = vi.fn(offlineFetch);
    const body = await runAsk({ query: "What are the opening hours of The Coronet?", fetchImpl: transport });
    expect(gradePalCase(body, reference, index).pass).toBe(true);
    expect(transport).not.toHaveBeenCalled();
  });

  it("uses the user's named pub instead of speculative tool arguments", async () => {
    const query = "What are the opening hours of The Coronet?";
    const body = await runAskTool("venue_prices", { venueId: "venue-zottpx" }, { query, cityId: "london", skipModel: true });
    expect(body.cards.map((card) => card.venueId)).toEqual(["venue-60y3sa"]);
    expect(body.answerHint).toContain("Opening hours for The Coronet are not known");
  });

  it.each([
    "The opening hours of The Coronet are not known.",
    "I cannot confirm the opening hours of The Coronet.",
    "No opening hours are recorded for The Coronet.",
  ])("accepts an explicit absence statement: %s", (answer) => {
    expect(gradePalCase({ ...response, answer }, reference, index).pass).toBe(true);
  });

  it.each(["23:00", "11pm", "11 p.m.", "11.30 pm", "midnight", "noon", "24 hours", "open now", "closed now", "open all day"])(
    "rejects an unsupported hours claim beside an absence statement: %s",
    (claim) => {
      const result = gradePalCase({ ...response, answer: `${response.answer} Expect ${claim}.` }, reference, index);
      expect(result.checks).toContainEqual(expect.objectContaining({ name: "unknown_hours_empty", pass: false }));
    },
  );

  it("checks card notes as well as the answer", () => {
    const result = gradePalCase({ ...response, cards: [{
      key: "coronet", venueId: "venue-60y3sa", title: "The Coronet", place: "London",
      price: null, note: "Closes at 23:00.",
    }] }, reference, index);
    expect(result.pass).toBe(false);
  });

  it("does not mistake an unknown price for unknown opening hours", () => {
    expect(gradePalCase({ ...response, answer: "The price is unknown." }, reference, index).pass).toBe(false);
  });
});
