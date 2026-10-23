import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import dataset from "@/evals/pal/fail-closed-hours.json";
import { gradePalCase } from "@/evals/pal/grade";
import { offlineFetch } from "@/evals/pal/offlineFetch";
import type { PalEvalAnswerExpectations } from "@/evals/pal/types";
import { loadPalEvalVenueIndex } from "@/evals/pal/venueIndex";
import { runAsk } from "@/lib/ask/runAsk";
import { runAskTool } from "@/lib/ask/tools";
import { resetCityStatusCache } from "@/lib/citymcp/client";
import type { AskResponseBody } from "@/lib/ask/types";
import { getVenueDetail } from "@/lib/venueDetailIndex";
import { planOpeningSchedulesForVenues } from "@/lib/planRouteEvidence.server";

// This evaluator exercises missing hours and website evidence. Keep later
// Google Places enrichment from changing those fixed source conditions.
vi.mock("@/lib/placesEnrichment.server", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/placesEnrichment.server")>(),
  placesRecordForVenue: async () => null,
}));

const index = loadPalEvalVenueIndex();
const reference = { hoursAnswer: { venueId: "venue-1ibpzru", value: null } } as const;
const now = Date.parse(dataset.now);
function expectations(entry: typeof dataset.cases[number]): PalEvalAnswerExpectations {
  if (entry.value === null) return { hoursAnswer: { venueId: entry.venueId, value: null } };
  if (!entry.source) throw new Error(`Missing hours source for ${entry.id}`);
  return { hoursAnswer: { venueId: entry.venueId, value: entry.value, source: entry.source, ...(entry.sourceUrl ? { sourceUrl: entry.sourceUrl } : {}) } };
}
const knownCase = dataset.cases.find((entry) => entry.id === "hours-crosse-keys")!;
const knownReference = expectations(knownCase);
function askKnown() {
  return runAsk({ query: knownCase.query, now, skipModel: true, fetchImpl: offlineFetch });
}
const response: AskResponseBody = {
  answer: "The opening hours of The Bird & Barrel are not known.",
  cards: [{ key: "hours:venue-1ibpzru", venueId: "venue-1ibpzru", title: "The Bird & Barrel", place: "Islington", price: null, note: "" }],
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
    "What are the opening hours of The Crosse Keys and are there Tube delays?",
    "Are there Tube delays and what are the opening hours of The Crosse Keys?",
    "What are The Crosse Keys' opening hours, and are there Tube delays?",
    "What are the opening hours at a pub called The Crosse Keys, please, and are there Tube delays?",
  ])("retains both answers in a combined hours request: %s", async (query) => {
    resetCityStatusCache();
    const transport = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      jsonrpc: "2.0", result: { structuredContent: {
        asOf: new Date(now).toISOString(), signals: [],
        tubeLines: [{ line: "Central", status: "Minor delays" }],
      } },
    }), { headers: { "content-type": "application/json" } }));
    try {
      const body = await runAsk({ query, now, skipModel: true, fetchImpl: transport });
      expect(body.toolsUsed).toEqual(["city_status", "search_venues"]);
      expect(body.cards.map((card) => card.key)).toContain("city-status");
      expect(body.cards.map((card) => card.venueId)).toContain(knownCase.venueId);
      expect(body.answer).toContain("Central: Minor delays");
      expect(body.answer).toContain("Thursday 08:00 to 23:00");
      expect(body.sources).toContainEqual({ kind: "directory", label: knownCase.source, ...(knownCase.sourceUrl ? { url: knownCase.sourceUrl } : {}) });
      expect(transport).toHaveBeenCalledOnce();
      const result = await runAskTool("search_venues", { query }, { query, cityId: "london", now, skipModel: true });
      expect(gradePalCase({ ...body, answer: result.answerHint!, cards: result.cards }, knownReference, index).pass).toBe(true);
    } finally {
      resetCityStatusCache();
    }
  });

  it.each([
    ...["unknown", "not known", "not recorded", "not available", "unavailable"].map((absence) =>
      `The opening hours are listed, but the price is ${absence}.`),
    ...["cannot", "can't", "do not", "don't"].flatMap((inability) =>
      ["confirm", "verify", "provide", "know"].map((verb) =>
        `I ${inability} ${verb} the price, but the opening hours are listed.`)),
    "No hours are missing.",
    "No hours are unknown.",
    "No hours are not recorded.",
    "The opening hours are not unknown.",
    "The opening hours are not unavailable.",
    "The opening hours for The Bird & Barrel are not unknown.",
    "The opening hours for The Bird & Barrel not unknown.",
  ])("rejects incorrect hours topic or polarity: %s", async (answer) => {
    const body = await runAsk({ query: "What are the opening hours of The Bird & Barrel?", now, skipModel: true });
    expect(body.cards.map((card) => card.venueId)).toEqual(["venue-1ibpzru"]);
    expect(gradePalCase({ ...body, answer }, reference, index).checks).toContainEqual(
      expect.objectContaining({ name: "unknown_hours_disclosed", pass: false }),
    );
  });

  it.each([
    ...["unknown", "not known", "not recorded", "not available", "unavailable"].map((absence) =>
      `The opening hours of The Bird & Barrel are ${absence}.`,
    ),
    ...["cannot", "can't", "do not", "don't"].flatMap((inability) =>
      ["confirm", "verify", "provide", "know"].map((verb) => `I ${inability} ${verb} the opening hours of The Bird & Barrel.`)),
    "No opening hours.",
    "No opening hours are recorded for The Bird & Barrel.",
    "No opening hours recorded for The Bird & Barrel.",
    "The price is listed, but the opening hours are unknown.",
  ])("accepts a bounded missing-hours statement: %s", (answer) => {
    expect(gradePalCase({ ...response, answer }, reference, index).pass).toBe(true);
  });

  it.each([
    "What are the opening hours of Erin's?",
    "What are Erin's opening hours?",
    "What are Erin's's opening hours?",
    "What are the opening hours of Erin's's?",
    "What are the opening hours at a pub called Erin's?",
    "What are the opening hours at a pub named Erin's?",
    "What are the opening hours at a pub called Erin's's?",
    "What are the opening hours at a pub named Erin's's?",
    "What are the opening hours of Erin’s, please?",
  ])("preserves the listed apostrophe-s name: %s", async (query) => {
    const venue = await getVenueDetail("venue-18orf8o");
    expect(venue?.name).toBe("Erin's");
    expect(venue?.siteFacts?.hours).toBeDefined();
    const body = await runAsk({ query, now, skipModel: true, fetchImpl: offlineFetch });
    expect(body.cards.map((card) => card.venueId)).toEqual(["venue-18orf8o"]);
    expect(body.answer).toContain("Erin's: recorded regular opening hours:");
    expect(body.answer).toContain("Thursday 11:30 to 23:00");
    expect(body.cards[0]?.provenance?.url).toBe(venue?.siteFacts?.sourceUrl);
    const result = await runAskTool("search_venues", { query }, { query, cityId: "london", now, skipModel: true });
    expect(result.cards.map((card) => card.venueId)).toEqual(["venue-18orf8o"]);
    expect(result.answerHint).toBe(body.answer);
  });

  it.each([
    "What are The Crosse Keys' opening hours?",
    "What are the opening hours of The Crosse Keys, please?",
  ])("preserves ordinary question framing: %s", async (query) => {
    const body = await runAsk({ query, now, skipModel: true, fetchImpl: offlineFetch });
    expect(gradePalCase(body, knownReference, index).pass).toBe(true);
  });

  it.each([
    "Find me one quiet pub in Soho with late opening hours",
    "Find me two cosy local pubs in Soho with late opening hours",
    "Find me 3 good nearby bars in Soho with late opening hours",
    "Find me six historic venues in Soho with late closing times",
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
      : { ...response, cards: [{ key: "bird-barrel", venueId: "venue-1ibpzru", title: "The Bird & Barrel", place: "London", price: null, note: "Closes at 24:00." }] };
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
      key: "bird-barrel", venueId: "venue-1ibpzru", title: "The Bird & Barrel", place: "London", price: null,
      note: line, provenance: source,
    }], sources: [source] };
    expect(gradePalCase(body, { hoursAnswer: { venueId: "venue-1ibpzru", value: [line], source: source.label } }, index).pass).toBe(true);
  });

  it("pins ten unknown schedules and two website schedules without Google Places enrichment", async () => {
    expect(Number.isFinite(now)).toBe(true);
    expect(new Set(dataset.cases.map((entry) => entry.id)).size).toBe(12);
    expect(new Set(dataset.cases.map((entry) => entry.venueId)).size).toBe(12);
    expect(dataset.cases.filter((entry) => entry.value === null)).toHaveLength(10);
    const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    for (const entry of dataset.cases) {
      const venue = await getVenueDetail(entry.venueId);
      expect(venue, entry.id).not.toBeNull();
      if (!venue) throw new Error(`Missing venue ${entry.venueId}`);
      if (entry.value === null) {
        expect(venue.placesContent?.regularOpeningHours, entry.id).toBeUndefined();
        expect(venue.siteFacts?.hours, entry.id).toBeUndefined();
        const schedules = await planOpeningSchedulesForVenues([{
          id: venue.id, name: venue.name, area: venue.primaryBorough, lat: venue.latitude, lng: venue.longitude,
        }]);
        expect(schedules.get(venue.id), entry.id).toBeNull();
      } else if (entry.source === "Google Places. Checked 2026-10-04") {
        const field = venue.placesContent?.regularOpeningHours;
        expect(field?.observedAt.slice(0, 10), entry.id).toBe("2026-10-04");
        expect(entry.sourceUrl).toBeNull();
        const clock = (time: { hour: number; minute: number }) => `${String(time.hour).padStart(2, "0")}:${String(time.minute).padStart(2, "0")}`;
        const periods = field?.value.periods as Array<{ open: { day: number; hour: number; minute: number }; close: { hour: number; minute: number } }> | undefined;
        const lines = periods?.map((period) => {
          if (!period.open || !period.close) throw new Error(`Missing period for ${entry.id}`);
          return `${days[period.open.day]} ${clock(period.open)} to ${clock(period.close)}`;
        });
        expect(lines, entry.id).toEqual(entry.value);
      } else {
        expect(venue.placesContent?.regularOpeningHours, entry.id).toBeUndefined();
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
    }] }, { hoursAnswer: { venueId: "venue-1ibpzru", value: null } }, index);
    expect(result.checks).toContainEqual(expect.objectContaining({ name: "hours_venue", pass: false }));
  });
  it("answers the named pub instead of returning unrelated picks", async () => {
    const venue = await getVenueDetail("venue-1ibpzru");
    expect(venue?.name).toBe("The Bird & Barrel");
    expect(venue?.openingHours).toBeUndefined();
    const body = await runAsk({
      query: "What are the opening hours of The Bird & Barrel?",
      cityId: "london",
      now: Date.parse("2026-10-22T18:00:00Z"),
      skipModel: true,
      fetchImpl: offlineFetch,
    });
    const result = gradePalCase(body, reference, index);
    expect(result.checks.filter((check) => !check.pass)).toEqual([]);
    expect(body.cards.map((card) => card.venueId)).toEqual(["venue-1ibpzru"]);
    expect(gradePalCase({ ...body, answer: "Four picks from the listed pubs." }, reference, index).pass).toBe(false);
  });

  it.each([
    "Show me the opening hours of The Bird & Barrel.",
    "What are the opening times at The Bird & Barrel?",
    "What are the closing times for The Bird & Barrel?",
  ])("keeps the named hours question out of map and discovery routing: %s", async (query) => {
    const body = await runAsk({ query, skipModel: true, fetchImpl: offlineFetch });
    expect(body.cards.map((card) => card.venueId)).toEqual(["venue-1ibpzru"]);
    expect(body.proposals).toEqual([]);
    expect(gradePalCase(body, reference, index).pass).toBe(true);
  });

  it("returns known regular hours with the named publisher and date", async () => {
    const body = await runAsk({
      query: "What are the opening hours of The Crosse Keys?",
      now: Date.parse("2026-10-22T18:00:00Z"), skipModel: true, fetchImpl: offlineFetch,
    });
    expect(body.cards).toHaveLength(1);
    expect(body.cards[0]?.venueId).toBe("venue-zottpx");
    expect(body.answer).toContain("Thursday 08:00 to 23:00");
    expect(body.answer).toContain("Holiday and one-off hours may differ.");
    expect(body.cards[0]?.provenance).toEqual({
      kind: "directory", label: "Google Places. Checked 2026-10-04",
    });
    expect(body.sources).toContainEqual(body.cards[0]?.provenance);
  });

  it("does not reuse stale hours as current hours", async () => {
    const body = await runAsk({
      query: "What are the opening hours of The Crosse Keys?",
      now: Date.parse("2030-10-22T18:00:00Z"), skipModel: true, fetchImpl: offlineFetch,
    });
    expect(gradePalCase(body, { hoursAnswer: { venueId: knownCase.venueId, value: null } }, index).pass).toBe(true);
    expect(body.cards[0]?.provenance).toBeUndefined();
  });

  it("asks for a pub name when no listed venue matches", async () => {
    const body = await runAsk({ query: "What are the opening hours of Imaginary Moon Tavern?", skipModel: true });
    expect(body.cards).toEqual([]);
    expect(body.answer).toContain("Which pub do you mean?");
  });

  it.each([
    "What are the opening hours of The Bird & Barrel?",
    "What are the opening hours at a pub called The Bird & Barrel?",
  ])("answers recorded hours without a model call even when providers are configured: %s", async (query) => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-not-a-key");
    vi.stubEnv("TYPESAFE_API_KEY", "test-not-a-key");
    const transport = vi.fn(offlineFetch);
    const body = await runAsk({ query, fetchImpl: transport });
    expect(gradePalCase(body, reference, index).pass).toBe(true);
    expect(transport).not.toHaveBeenCalled();
  });

  it("uses the user's named pub instead of speculative tool arguments", async () => {
    const query = "What are the opening hours of The Bird & Barrel?";
    const body = await runAskTool("venue_prices", { venueId: "venue-zottpx" }, { query, cityId: "london", skipModel: true });
    expect(body.cards.map((card) => card.venueId)).toEqual(["venue-1ibpzru"]);
    expect(body.answerHint).toContain("Opening hours for The Bird & Barrel are not known");
  });

  it.each([
    "The opening hours of The Bird & Barrel are not known.",
    "I cannot confirm the opening hours of The Bird & Barrel.",
    "No opening hours are recorded for The Bird & Barrel.",
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
      key: "bird-barrel", venueId: "venue-1ibpzru", title: "The Bird & Barrel", place: "London",
      price: null, note: "Closes at 23:00.",
    }] }, reference, index);
    expect(result.pass).toBe(false);
  });

  it("does not mistake an unknown price for unknown opening hours", () => {
    expect(gradePalCase({ ...response, answer: "The price is unknown." }, reference, index).pass).toBe(false);
  });
});
