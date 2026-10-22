import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import dataset from "@/evals/pal/fail-closed-hours.json";
import { gradePalCase } from "@/evals/pal/grade";
import { offlineFetch } from "@/evals/pal/offlineFetch";
import type { PalEvalAnswerExpectations } from "@/evals/pal/types";
import { loadPalEvalVenueIndex } from "@/evals/pal/venueIndex";
import { runAsk } from "@/lib/ask/runAsk";
import { runAskTool } from "@/lib/ask/tools";
import type { AskResponseBody } from "@/lib/ask/types";
import { getVenueDetail } from "@/lib/venueDetailIndex";
import { planOpeningSchedulesForVenues } from "@/lib/planRouteEvidence.server";

const index = loadPalEvalVenueIndex();
const reference = { hoursAnswer: { value: null } } as const;
const now = Date.parse(dataset.now);
function expectations(entry: typeof dataset.cases[number]): PalEvalAnswerExpectations {
  if (entry.value === null) return { hoursAnswer: { venueId: entry.venueId, value: null } };
  if (!entry.source || !entry.sourceUrl) throw new Error(`Missing hours source for ${entry.id}`);
  return { hoursAnswer: { venueId: entry.venueId, value: entry.value, source: entry.source, sourceUrl: entry.sourceUrl } };
}
const knownCase = dataset.cases.find((entry) => entry.id === "hours-crosse-keys")!;
const knownReference = expectations(knownCase);
function askKnown() {
  return runAsk({ query: knownCase.query, now, skipModel: true, fetchImpl: offlineFetch });
}
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

describe("Pal fail-closed hours eval", () => {
  it.each([
    "Find me a pub in Soho with late opening hours",
    "Find me a quiet pub in Soho with late opening hours",
    "Find me a welcoming dog-friendly pub in Soho with late opening hours",
    "Find me a pub in Soho near a pub called The Crosse Keys with late opening hours",
    "Show me pubs in Soho with late closing times",
    "Find somewhere in Soho with late opening times",
  ])("preserves discovery through runAsk and tool dispatch: %s", async (query) => {
    const body = await runAsk({ query, now, skipModel: true, fetchImpl: offlineFetch });
    expect(body.cards.length).toBeGreaterThan(0);
    expect(body.answer).not.toContain("Which pub do you mean?");
    expect(body.toolsUsed).toEqual(["search_venues"]);
    const result = await runAskTool("search_venues", { query }, { query, cityId: "london", now, skipModel: true });
    expect(result.cards.length).toBeGreaterThan(0);
    expect(result.answerHint).not.toContain("Which pub do you mean?");
  });

  it.each([
    "What are the opening hours at a pub called The Crosse Keys?",
    "What are the opening hours at a pub named The Crosse Keys?",
    "What are the opening hours at a quiet pub called The Crosse Keys?",
  ])("preserves an explicit venue name through runAsk and dispatch: %s", async (query) => {
    const body = await runAsk({ query, now, skipModel: true, fetchImpl: offlineFetch });
    expect(gradePalCase(body, knownReference, index).pass).toBe(true);
    const result = await runAskTool("search_venues", { query }, { query, cityId: "london", now, skipModel: true });
    expect(result.answerHint).toContain("The Crosse Keys: recorded regular opening hours:");
    expect(result.cards[0]?.venueId).toBe(knownCase.venueId);
  });

  it.each(["answer", "card"] as const)("rejects unsupported 24:00 in an unknown-hours %s", (target) => {
    const body = target === "answer"
      ? { ...response, answer: `${response.answer} Closes at 24:00.` }
      : { ...response, cards: [{ key: "coronet", venueId: "venue-60y3sa", title: "The Coronet", place: "London", price: null, note: "Closes at 24:00." }] };
    expect(gradePalCase(body, reference, index).checks).toContainEqual(
      expect.objectContaining({ name: "unknown_hours_empty", pass: false }),
    );
  });

  it.each(["answer", "card"] as const)("rejects extra 24:00 in a known-hours %s", async (target) => {
    const original = await askKnown();
    const body = target === "answer"
      ? { ...original, answer: `${original.answer} Closes at 24:00.` }
      : { ...original, cards: original.cards.map((card) => ({ ...card, note: `${card.note} Closes at 24:00.` })) };
    const result = gradePalCase(body, knownReference, index);
    expect(result.checks).toContainEqual(expect.objectContaining({ name: "known_hours_value", pass: false }));
    if (target === "card") {
      expect(result.checks).toContainEqual(expect.objectContaining({ name: "known_hours_source", pass: false }));
    }
  });

  it("accepts recorded 24:00 closing hours", () => {
    const source = { kind: "directory" as const, label: "Recorded website" };
    const line = "Thursday 12:00 to 24:00";
    const body = { ...response, answer: line, cards: [{
      key: "coronet", venueId: "venue-60y3sa", title: "The Coronet", place: "London", price: null,
      note: line, provenance: source,
    }], sources: [source] };
    expect(gradePalCase(body, { hoursAnswer: { venueId: "venue-60y3sa", value: [line], source: source.label } }, index).pass).toBe(true);
  });

  it("pins ten unknown schedules and two sourced schedules to the venue dataset", async () => {
    expect(Number.isFinite(now)).toBe(true);
    expect(new Set(dataset.cases.map((entry) => entry.id)).size).toBe(12);
    expect(new Set(dataset.cases.map((entry) => entry.venueId)).size).toBe(12);
    expect(dataset.cases.filter((entry) => entry.value === null)).toHaveLength(10);
    const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    for (const entry of dataset.cases) {
      const venue = await getVenueDetail(entry.venueId);
      expect(venue, entry.id).not.toBeNull();
      if (!venue) throw new Error(`Missing venue ${entry.venueId}`);
      expect(venue.placesContent?.regularOpeningHours, entry.id).toBeUndefined();
      if (entry.value === null) {
        expect(venue.siteFacts?.hours, entry.id).toBeUndefined();
        const schedules = await planOpeningSchedulesForVenues([{
          id: venue.id, name: venue.name, area: venue.primaryBorough, lat: venue.latitude, lng: venue.longitude,
        }]);
        expect(schedules.get(venue.id), entry.id).toBeNull();
      } else {
        const facts = venue.siteFacts;
        expect(facts?.sourceUrl, entry.id).toBe(entry.sourceUrl);
        expect(entry.source).toBe(`${venue.name} website. Checked ${facts?.readOn}`);
        const lines = Object.entries(facts?.hours?.hours ?? {}).flatMap(([day, windows]) =>
          windows?.map((window) => `${days[Number(day)]} ${window.opens} to ${window.closes}`) ?? []);
        expect(lines, entry.id).toEqual(entry.value);
      }
    }
  });

  it.each(dataset.cases)("$id answers honestly through runAsk without network access", async (entry) => {
    const body = await runAsk({ query: entry.query, now, skipModel: true, fetchImpl: offlineFetch });
    const result = gradePalCase(body, expectations(entry), index);
    expect(result.checks.filter((check) => !check.pass)).toEqual([]);
  });

  it("rejects an absence answer when the requested hours are known", () => {
    const result = gradePalCase({ ...response, answer: "The opening hours of The Crosse Keys are not known." }, knownReference, index);
    expect(result.pass).toBe(false);
  });

  it.each([
    ["wrong time", "Thursday 08:00 to 23:00", "Thursday 09:00 to 23:00"],
    ["wrong weekday", "Thursday 08:00 to 23:00", "Friday 08:00 to 23:00"],
    ["missing day", "Thursday 08:00 to 23:00", ""],
    ["extra clock time", "Holiday and one-off hours may differ.", "Expect 02:00."],
    ["extra known time", "Holiday and one-off hours may differ.", "Expect 23:00."],
    ["extra closure", "Holiday and one-off hours may differ.", "Thursday closed."],
  ])("rejects %s in a known-hours answer", async (_label, before, after) => {
    const body = await askKnown();
    const result = gradePalCase({ ...body, answer: body.answer.replace(before, after) }, knownReference, index);
    expect(result.checks).toContainEqual(expect.objectContaining({ name: "known_hours_value", pass: false }));
  });

  it.each([undefined, { kind: "directory" as const, label: "Invented publisher", url: "https://example.com" },
    { kind: "directory" as const, label: "The Crosse Keys website. Checked 2026-10-05", url: "https://example.com" },
  ])("rejects missing or incorrect hours provenance: %j", async (provenance) => {
    const body = await askKnown();
    const result = gradePalCase({ ...body, cards: body.cards.map((card) => ({ ...card, provenance })) }, knownReference, index);
    expect(result.checks).toContainEqual(expect.objectContaining({ name: "known_hours_source", pass: false }));
  });

  it("requires the source on the card that carries the recorded hours", async () => {
    const body = await askKnown();
    const result = gradePalCase({ ...body, cards: body.cards.flatMap((card) => [
      { ...card, provenance: undefined }, { ...card, key: `${card.key}-empty`, note: "" },
    ]) }, knownReference, index);
    expect(result.checks).toContainEqual(expect.objectContaining({ name: "known_hours_source", pass: false }));
  });

  it("rejects an unsupported time in a known-hours card", async () => {
    const body = await askKnown();
    const result = gradePalCase({ ...body, cards: body.cards.map((card) => ({ ...card, note: `${card.note} Expect 02:00.` })) }, knownReference, index);
    expect(result.pass).toBe(false);
  });

  it("rejects an absence answer for the wrong venue", () => {
    const result = gradePalCase({ ...response, cards: [{
      key: "wrong", venueId: "venue-ru7vbr", title: "The Argyll Arms", place: "London", price: null, note: "",
    }] }, { hoursAnswer: { venueId: "venue-60y3sa", value: null } }, index);
    expect(result.checks).toContainEqual(expect.objectContaining({ name: "hours_venue", pass: false }));
  });
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

  it.each([
    "What are the opening hours of The Coronet?",
    "What are the opening hours at a pub called The Coronet?",
  ])("answers recorded hours without a model call even when providers are configured: %s", async (query) => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-not-a-key");
    vi.stubEnv("TYPESAFE_API_KEY", "test-not-a-key");
    const transport = vi.fn(offlineFetch);
    const body = await runAsk({ query, fetchImpl: transport });
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
