import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { gradePalCase } from "@/evals/pal/grade";
import { offlineFetch } from "@/evals/pal/offlineFetch";
import { loadPalEvalVenueIndex } from "@/evals/pal/venueIndex";
import { runAsk } from "@/lib/ask/runAsk";
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
  it("detects the current unrelated-picks answer to an opening-hours question", async () => {
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
    expect(result.checks).toContainEqual(expect.objectContaining({ name: "unknown_hours_disclosed", pass: false }));
    expect(gradePalCase({ ...body, answer: "Four picks from the listed pubs." }, reference, index).pass).toBe(false);
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
