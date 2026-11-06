import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { composeAnswer, mergeToolResults, runAsk } from "@/lib/ask/runAsk";
import { runAskTool } from "@/lib/ask/tools";
import { resolveLateFoodQuery } from "@/lib/ask/lateFoodQuestion";
import { answerLateFoodQuestion } from "@/lib/ask/lateFoodAnswer.server";
import { resolveAskJourney, routeAskDeterministically } from "@/lib/ask/routingPolicy";
import { resolvePubPalToolQuery } from "@/lib/pubPalToolInvoke.server";
import { offlineFetch } from "@/evals/pal/offlineFetch";

const OCTOBER_REVIEW_NOW = Date.parse("2026-10-22T18:00:00.000Z");
const SOHO_HOURS_SOURCE = "https://balans.co.uk/locations/soho-no-60/";

beforeEach(() => {
  for (const key of ["OPENROUTER_API_KEY", "TYPESAFE_API_KEY", "SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) {
    vi.stubEnv(key, "");
  }
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () => {
    throw new Error("Late-food Ask tests must stay offline.");
  }));
});
afterEach(() => {
  try {
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  }
});

async function ask(query: string, now = OCTOBER_REVIEW_NOW, cityId = "london") {
  return runAsk({ query, now, cityId, skipModel: true, fetchImpl: offlineFetch });
}

describe("late-food questions through Ask", () => {
  it("does not substitute ordinary pubs for unsupported Covent Garden coverage", async () => {
    const response = await ask("Food at 01:00 on 2026-10-23 near Covent Garden");
    expect(response.cards).toEqual([]);
    expect(response.proposals).toEqual([]);
    expect(response.sources).toEqual([]);
    expect(response.answer).toMatch(/food/i);
    expect(response.answer).toMatch(/record|evidence|sourced|coverage/i);
  });

  it.each([
    { query: "Food at 01:00 on 2026-10-23 near Soho", now: OCTOBER_REVIEW_NOW },
    { query: "Food at 01:00 on 2026-10-30 near Soho", now: Date.parse("2026-10-29T18:00:00.000Z") },
  ])("uses current overnight service evidence in BST and GMT: $query", async ({ query, now }) => {
    const response = await ask(query, now);
    expect(response.cards).toHaveLength(1);
    expect(response.cards[0]).toMatchObject({
      key: "late-food-evidence-piccadilly-soho-balans-no-60",
      title: "Balans No.60",
      venueId: "",
      price: null,
    });
    expect(response.cards[0]?.note).toMatch(/04:30/);
    expect(response.cards[0]?.note).toMatch(/check|confirm|verify/i);
    expect(response.proposals).toEqual([]);
    expect(response.sources).toContainEqual(expect.objectContaining({ url: SOHO_HOURS_SOURCE }));
    expect(response.sources.some((source) => source.label.includes("17 October 2026") || source.label.includes("2026-10-17"))).toBe(true);
  });

  it("resolves tonight at 1am to Friday after a Thursday evening request", async () => {
    const response = await ask("Where can I eat in Soho tonight at 1am?", OCTOBER_REVIEW_NOW);
    expect(response.cards.map((card) => card.title)).toEqual(["Balans No.60"]);
    expect(response.cards[0]).toMatchObject({ venueId: "", price: null });
    expect(response.sources).toContainEqual(expect.objectContaining({ url: SOHO_HOURS_SOURCE }));
    expect(response.proposals).toEqual([]);
  });

  it.each([
    "Food in Soho tonight 1am",
    "Food in Soho 01:00 on 2026-10-23",
  ])("uses recorded food evidence without an at prefix: %s", async (query) => {
    const typed = await ask(query);
    const tool = await runAskTool("propose_plan", {}, {
      query, cityId: "london", now: OCTOBER_REVIEW_NOW, skipModel: true, fetchImpl: offlineFetch,
    });
    for (const response of [typed, tool]) {
      expect(response.cards.map((card) => card.title)).toEqual(["Balans No.60"]);
      expect(response.cards[0]).toMatchObject({ venueId: "", price: null });
      expect(response.proposals).toEqual([]);
    }
  });

  it.each(["25:00", "1", "an unknown time", "01:00 and 02:00"])("clarifies unresolved food timing: %s", async (clock) => {
    const response = await ask(`Food in Soho tonight at ${clock}`);
    expect(response.cards).toEqual([]);
    expect(response.proposals).toEqual([]);
    expect(response.answer).toContain("Which night and time");
  });

  it.each([
    "Food in Soho at noon",
    "Food in Soho at midnight",
    "Food in Soho on Friday",
    "Food in Soho on 2026-10-23",
    "Food in Soho tonight",
    "Food in Soho tomorrow",
    "Late food in Soho",
    "Food in Soho at midnight and 01:00 on 2026-10-26",
    "Food in Soho at noon and 01:00 on 2026-10-26",
    "Food in Soho at midnight and noon on 2026-10-26",
  ])("clarifies incomplete or multiple requested food times: %s", async (query) => {
    const typed = await ask(query);
    const voice = await runAskTool("search_venues", {}, {
      query, cityId: "london", now: OCTOBER_REVIEW_NOW, skipModel: true, fetchImpl: offlineFetch,
    });
    for (const response of [typed, voice]) {
      expect(response.cards).toEqual([]);
      expect(response.proposals).toEqual([]);
      expect("sources" in response ? response.sources : response.provenance).toEqual([]);
      expect("answer" in response ? response.answer : response.answerHint).toContain("Which night and time");
    }
  });

  it.each(["Vegan", "Halal", "Kosher", "Gluten-free", "Dairy-free", "Sandwiches", "Breakfast", "Snacks"])("retains %s constraints beside transport wording in another sentence", async (constraint) => {
    const query = `Food in Soho tonight at 1am. ${constraint} please, close to the tube`;
    const typed = await ask(query);
    const voice = await runAskTool("search_venues", {}, {
      query, cityId: "london", now: OCTOBER_REVIEW_NOW, skipModel: true, fetchImpl: offlineFetch,
    });
    for (const response of [typed, voice]) {
      expect(response.cards).toEqual([]);
      expect(response.proposals).toEqual([]);
      expect("sources" in response ? response.sources : response.provenance).toEqual([]);
      expect("answer" in response ? response.answer : response.answerHint).toMatch(/no current.*record/i);
    }
  });

  it("uses the recorded Sunday service at midnight on Monday", async () => {
    const response = await ask("Food in Soho at midnight on 2026-10-26", Date.parse("2026-10-25T18:00:00.000Z"));
    expect(response.cards.map((card) => card.title)).toEqual(["Balans No.60"]);
    expect(response.sources).toContainEqual(expect.objectContaining({ url: SOHO_HOURS_SOURCE }));
    expect(response.proposals).toEqual([]);
  });

  it.each([
    "Find pubs with food at The Devonshire in Soho",
    "Food at The Devonshire in Soho",
  ])("does not treat a food location as timing: %s", async (query) => {
    expect(answerLateFoodQuestion({ query, cityId: "london", now: OCTOBER_REVIEW_NOW })).toBeNull();
    const typed = await ask(query);
    const tool = await runAskTool("search_venues", {}, {
      query, cityId: "london", now: OCTOBER_REVIEW_NOW, skipModel: true, fetchImpl: offlineFetch,
    });
    expect(typed.answer).not.toContain("Which night and time");
    expect(tool.answerHint).not.toContain("Which night and time");
  });

  it.each([
    "Food in Soho at an unknown time",
    "Food at The Devonshire in Soho at an unknown time",
  ])("clarifies unresolved timing without a night word: %s", async (query) => {
    const typed = await ask(query);
    const tool = await runAskTool("search_venues", {}, {
      query, cityId: "london", now: OCTOBER_REVIEW_NOW, skipModel: true, fetchImpl: offlineFetch,
    });
    for (const response of [typed, tool]) {
      expect(response.cards).toEqual([]);
      expect(response.proposals).toEqual([]);
      expect("answer" in response ? response.answer : response.answerHint).toContain("Which night and time");
    }
  });

  it("requires pub kitchen evidence when auxiliary verbs describe food service", async () => {
    const response = await ask("Which pubs are serving food in Soho tonight at 1am");
    expect(response.cards).toEqual([]);
    expect(response.proposals).toEqual([]);
    expect(response.answer).toContain("pub kitchen hours");
  });

  it.each(["burgers", "breakfast", "sandwiches"])("requires kitchen evidence for timed pub %s requests", async (food) => {
    const query = `Find four pubs serving ${food} in Soho tonight at 1am`;
    const typed = await ask(query);
    const voice = await runAskTool("search_venues", {}, {
      query, cityId: "london", now: OCTOBER_REVIEW_NOW, skipModel: true, fetchImpl: offlineFetch,
    });
    for (const response of [typed, voice]) {
      expect(response.cards).toEqual([]);
      expect(response.proposals).toEqual([]);
      expect("answer" in response ? response.answer : response.answerHint).toContain("pub kitchen hours");
    }
  });

  it.each(["burgers", "breakfast", "sandwiches"])("does not infer recorded %s service from generic food evidence", async (food) => {
    const response = await ask(`Find ${food} in Soho tonight at 1am`);
    expect(response.cards).toEqual([]);
    expect(response.sources).toEqual([]);
    expect(response.proposals).toEqual([]);
    expect(response.answer).toMatch(/no current.*record/i);
  });

  it.each([
    "restaurants serving sandwiches",
    "restaurants serving breakfast",
    "restaurants serving snacks",
    "restaurants serving lunch",
    "restaurants serving dinner",
    "restaurants serving supper",
    "restaurants serving burgers",
    "restaurants serving chips",
    "cafes and restaurants",
    "restaurants and cafes",
  ])("does not discard categories in a timed request for %s", async (food) => {
    const query = `Find ${food} in Soho at 01:00 on 2026-11-07`;
    const typed = await ask(query);
    const voice = await runAskTool("search_venues", {}, {
      query, cityId: "london", now: OCTOBER_REVIEW_NOW, skipModel: true, fetchImpl: offlineFetch,
    });
    for (const response of [typed, voice]) {
      expect(response.cards).toEqual([]);
      expect(response.proposals).toEqual([]);
      expect("sources" in response ? response.sources : response.provenance).toEqual([]);
      expect("answer" in response ? response.answer : response.answerHint).toMatch(/no current.*record/i);
    }
  });

  it("keeps recommendations for a single recorded restaurant category", async () => {
    const response = await ask("Find restaurants in Soho at 01:00 on 2026-11-07");
    expect(response.cards.map((card) => card.title)).toEqual(["Balans No.60"]);
    expect(response.sources).toContainEqual(expect.objectContaining({ url: SOHO_HOURS_SOURCE }));
  });

  it.each(["food", "eat", "eating", "meal", "meals", "kitchen", "somewhere to eat"])("does not treat generic %s wording as a category", async (food) => {
    const response = await ask(`Find restaurants with ${food} in Soho at 01:00 on 2026-11-07`);
    expect(response.cards.map((card) => card.title)).toEqual(["Balans No.60"]);
    expect(response.sources).toContainEqual(expect.objectContaining({ url: SOHO_HOURS_SOURCE }));
  });

  it.each([
    { query: "Directions to St. Pancras from The Blackfriar", from: "The Blackfriar", to: "St. Pancras" },
    { query: "Directions to The Blackfriar from St. Pancras", from: "St. Pancras", to: "The Blackfriar" },
    { query: "Directions from St. Pancras to The Blackfriar", from: "St. Pancras", to: "The Blackfriar" },
  ])("preserves abbreviated journey endpoints: $query", ({ query, from, to }) => {
    expect(resolveAskJourney(query)).toEqual({ from, to });
    expect(routeAskDeterministically(query)).toEqual([{ name: "journey", args: { from, to } }]);
  });

  it("resolves tonight at 1am to closed Monday service after a Sunday evening request", async () => {
    const response = await ask("Where can I eat in Soho tonight at 1am?", Date.parse("2026-10-25T18:00:00.000Z"));
    expect(response.cards).toEqual([]);
    expect(response.proposals).toEqual([]);
  });

  it.each([
    "Food at 06:00 on 2026-10-23 near Soho",
    "Food at 01:00 on 2026-10-23 near Victoria",
  ])("does not recommend a closed service: %s", async (query) => {
    const response = await ask(query);
    expect(response.cards).toEqual([]);
    expect(response.proposals).toEqual([]);
  });

  it("uses Sunday's service until Monday 00:30, with an exclusive closing boundary", async () => {
    const now = Date.parse("2026-10-25T18:00:00.000Z");
    const beforeClose = await ask("Food at 00:29 on 2026-10-26 near Soho", now);
    const atClose = await ask("Food at 00:30 on 2026-10-26 near Soho", now);
    expect(beforeClose.cards.map((card) => card.title)).toEqual(["Balans No.60"]);
    expect(atClose.cards).toEqual([]);
  });

  it("uses London's BST offset at the overnight closing boundary", async () => {
    const beforeClose = await ask("Food at 04:29 on 2026-10-23 near Soho");
    const atClose = await ask("Food at 04:30 on 2026-10-23 near Soho");
    expect(beforeClose.cards.map((card) => card.title)).toEqual(["Balans No.60"]);
    expect(atClose.cards).toEqual([]);
  });

  it("does not use currently valid evidence for a requested night beyond its expiry", async () => {
    const response = await ask("Food at 01:00 on 2026-11-20 near Soho");
    expect(response.cards).toEqual([]);
    expect(response.proposals).toEqual([]);
    expect(response.sources).toEqual([]);
  });

  it("does not serve a row after its review expires", async () => {
    const response = await ask("Food at 01:00 on 2026-11-20 near Soho", Date.parse("2026-11-17T18:00:00.000Z"));
    expect(response.cards).toEqual([]);
    expect(response.sources).toEqual([]);
  });

  it("does not revive lapsed Shoreditch evidence", async () => {
    const response = await ask("Food at 01:00 on 2026-10-23 near Shoreditch");
    expect(response.cards).toEqual([]);
    expect(response.sources).toEqual([]);
  });

  it.each(["Vegan food", "Halal restaurant food", "Gluten-free pizza"])("does not infer missing dietary evidence: %s", async (food) => {
    const response = await ask(`${food} at 01:00 on 2026-10-23 near Soho`);
    expect(response.cards).toEqual([]);
    expect(response.proposals).toEqual([]);
  });

  it.each(["Nut-free food", "Kosher food", "Dairy-free food", "Food for my peanut allergy"])("does not discard an unsupported food constraint: %s", async (food) => {
    const response = await ask(`${food} at 01:00 on 2026-10-23 near Soho`);
    expect(response.cards).toEqual([]);
    expect(response.proposals).toEqual([]);
    expect(response.sources).toEqual([]);
  });

  it.each([
    "Find four pubs with food in Soho at 13:00 on 2026-10-23",
    "Find four pubs for lunch in Soho at 13:00 on 2026-10-23",
    "Find four pubs with food in Soho at 13:00",
  ])("requires kitchen evidence for timed daytime pub discovery: %s", async (query) => {
    const response = await ask(query);
    expect(response.cards).toEqual([]);
    expect(response.proposals).toEqual([]);
    expect(response.answer).toMatch(/pub kitchen hours|Which night and time/);
  });

  it.each(["23:00", "16:00", "03:59"])("requires pub kitchen evidence outside daytime at %s", async (clock) => {
    const response = await ask(`Find four pubs with food in Soho tonight at ${clock}`);
    expect(response.cards).toEqual([]);
    expect(response.proposals).toEqual([]);
    expect(response.answer).toContain("pub kitchen hours");
  });

  it.each(["Chinese food", "Chinese restaurant food", "Spicy food", "Food with outdoor seating"])("does not discard an unrecorded food requirement: %s", async (food) => {
    const response = await ask(`${food} in Soho tonight at 1am`);
    expect(response.cards).toEqual([]);
    expect(response.proposals).toEqual([]);
    expect(response.sources).toEqual([]);
    expect(response.answer).toMatch(/no current.*record/i);
  });

  it("does not use daytime discovery to discard an unrecorded food requirement", async () => {
    const response = await ask("Find four pubs with Chinese food in Soho at 13:00");
    expect(response.cards).toEqual([]);
    expect(response.proposals).toEqual([]);
  });

  it("requires pub kitchen evidence for food after a pub visit", async () => {
    const response = await ask("Food after the pub in Soho tonight at 1am");
    expect(response.cards).toEqual([]);
    expect(response.proposals).toEqual([]);
    expect(response.answer).toContain("pub kitchen hours");
  });

  it.each([
    "Directions to London Bridge from The Blackfriar",
    "Any tube delays tonight?",
    "Directions to London Bridge from The Blackfriar. Any tube delays tonight?",
  ])("routes the food answer alongside transport: %s", async (transport) => {
    const response = await runAsk({
      query: `Food at 01:00 on 2026-10-23 near Covent Garden. ${transport}`,
      now: OCTOBER_REVIEW_NOW, cityId: "london", skipModel: true,
      fetchImpl: async () => Response.json({ jsonrpc: "2.0", result: { structuredContent: {
        journeys: [{ durationMinutes: 12, legs: [] }],
      } } }),
    });
    expect(response.toolsUsed).toContain("search_venues");
    expect(response.toolsUsed.some((tool) => tool === "journey" || tool === "city_status")).toBe(true);
    expect(response.answer).toContain("no current late-food record for Covent Garden");
    expect(response.proposals).toEqual([]);
    if (transport.startsWith("Directions")) {
      expect(response.cards).toContainEqual(expect.objectContaining({ note: "12 min" }));
    }
  });

  it("retains recorded food service alongside a grounded journey", async () => {
    const response = await runAsk({
      query: "Food in Soho tonight at 1am. Directions to London Bridge from The Blackfriar",
      now: OCTOBER_REVIEW_NOW, cityId: "london", skipModel: true,
      fetchImpl: async () => Response.json({ jsonrpc: "2.0", result: { structuredContent: {
        journeys: [{ durationMinutes: 12, legs: [] }],
      } } }),
    });
    expect(response.cards).toContainEqual(expect.objectContaining({ title: "Balans No.60", venueId: "", price: null }));
    expect(response.cards).toContainEqual(expect.objectContaining({ note: "12 min" }));
    expect(response.sources).toContainEqual(expect.objectContaining({ url: SOHO_HOURS_SOURCE }));
  });

  it.each([".", "?", "!"])("separates a food sentence after transport at %s", async (separator) => {
    const response = await runAsk({
      query: `Directions to London Bridge from The Blackfriar${separator} Food at 01:00 on 2026-10-23 near Soho`,
      now: OCTOBER_REVIEW_NOW, cityId: "london", skipModel: true,
      fetchImpl: async () => Response.json({ jsonrpc: "2.0", result: { structuredContent: {
        journeys: [{ durationMinutes: 12, legs: [] }],
      } } }),
    });
    expect(response.cards).toContainEqual(expect.objectContaining({ title: "Balans No.60", venueId: "", price: null }));
    expect(response.cards).toContainEqual(expect.objectContaining({ note: "12 min" }));
    expect(response.sources).toContainEqual(expect.objectContaining({ url: SOHO_HOURS_SOURCE }));
    expect(response.proposals).toEqual([]);
  });

  it("keeps abbreviated transport names out of food constraints", async () => {
    const response = await ask("Directions to St. Pancras from The Blackfriar. Food at 01:00 on 2026-10-23 near Soho");
    expect(response.cards).toContainEqual(expect.objectContaining({ title: "Balans No.60", venueId: "", price: null }));
    expect(response.sources).toContainEqual(expect.objectContaining({ url: SOHO_HOURS_SOURCE }));
  });

  it.each([
    { food: "Vegan food", names: [] },
    { food: "Late food", names: ["Balans No.60"] },
  ])("handles a $food sentence after transport without throwing", async ({ food, names }) => {
    const query = `Directions to London Bridge from The Blackfriar. ${food} at 01:00 on 2026-11-07 near Soho`;
    const typed = await ask(query);
    const voice = await runAskTool("search_venues", {}, {
      query, cityId: "london", now: OCTOBER_REVIEW_NOW, skipModel: true, fetchImpl: offlineFetch,
    });
    for (const response of [typed, voice]) {
      expect(response.cards.map((card) => card.title)).toEqual(names);
      expect(response.proposals).toEqual([]);
      if (names.length === 0) {
        expect("sources" in response ? response.sources : response.provenance).toEqual([]);
        expect("answer" in response ? response.answer : response.answerHint).toMatch(/no current.*record/i);
      }
    }
  });

  it("keeps transport timing separate from the food service date", async () => {
    const response = await ask("Food at 01:00 on 2026-10-23 near Soho. Any tube delays tonight?");
    expect(response.cards).toContainEqual(expect.objectContaining({ title: "Balans No.60", venueId: "", price: null }));
    expect(response.toolsUsed).toContain("city_status");
    expect(response.sources).toContainEqual(expect.objectContaining({ url: SOHO_HOURS_SOURCE }));
  });

  it("keeps an unrecorded cuisine when transport comes first", async () => {
    const response = await ask("Directions to London Bridge from The Blackfriar. Where can I get Chinese food in Soho tonight at 1am?");
    expect(response.cards).toEqual([]);
    expect(response.proposals).toEqual([]);
    expect(response.sources).not.toContainEqual(expect.objectContaining({ url: SOHO_HOURS_SOURCE }));
    expect(response.answer).toMatch(/no current.*record/i);
  });

  it("clarifies conflicting area clauses rather than choosing the first area", async () => {
    const response = await ask("Food at 01:00 on 2026-10-23 near Soho, actually near Victoria");
    expect(response.cards).toEqual([]);
    expect(response.proposals).toEqual([]);
    expect(response.sources).toEqual([]);
    expect(response.answer).toMatch(/(?:which|what).*(?:area|place)|(?:area|place).*(?:choose|clarify)/i);
  });

  it("keeps the missing-food explanation beside an independent grounded journey", async () => {
    const query = "Food at 01:00 on 2026-10-23 near Covent Garden";
    const food = await runAskTool("search_venues", {}, {
      cityId: "london", query, now: OCTOBER_REVIEW_NOW, skipModel: true, fetchImpl: offlineFetch,
    });
    const journeyFetch: typeof fetch = async () => Response.json({ jsonrpc: "2.0", result: { structuredContent: {
      journeys: [{ durationMinutes: 12, legs: [] }],
    } } });
    const journey = await runAskTool("journey", { from: "The Blackfriar", to: "London Bridge" }, {
      cityId: "london", query: "Directions to London Bridge from The Blackfriar",
      now: OCTOBER_REVIEW_NOW, skipModel: true, fetchImpl: journeyFetch,
    });
    const merged = mergeToolResults([food, journey]);
    const answer = composeAnswer(merged.hints, merged.cards, merged.toolsUsed);
    expect(merged.cards).toContainEqual(expect.objectContaining({ note: "12 min" }));
    expect(answer).toContain(food.answerHint);
    expect(answer).toMatch(/food/i);
    expect(merged.sources).toContainEqual(expect.objectContaining({ kind: "citymcp" }));
  });

  it.each(["kebabs", "cafés"])("does not replace an unsupported plural cuisine with a generic restaurant: %s", async (cuisine) => {
    const response = await ask(`Where can I get ${cuisine} in Soho tonight at 1am?`);
    expect(response.cards).toEqual([]);
    expect(response.proposals).toEqual([]);
    expect(response.sources).toEqual([]);
  });

  it("does not use London evidence for another city", async () => {
    const response = await ask("Food at 01:00 on 2026-10-23 near Soho", OCTOBER_REVIEW_NOW, "manchester");
    expect(response.cards).toEqual([]);
    expect(response.sources).toEqual([]);
  });

  it("asks for a time and night instead of silently choosing a post-midnight instant", async () => {
    const response = await ask("Food after midnight near Soho");
    expect(response.cards).toEqual([]);
    expect(response.answer).toMatch(/(?:which|what).*(?:night|date|time)|(?:night|date|time).*(?:need|choose|tell)/i);
  });

  it("keeps ordinary pub-with-food discovery on its existing route", async () => {
    const response = await ask("Find four pubs with food in Soho");
    expect(response.cards.length).toBeGreaterThan(0);
    expect(response.cards.every((card) => card.venueId.startsWith("venue-"))).toBe(true);
    expect(response.cards.some((card) => card.key.startsWith("late-food-evidence-"))).toBe(false);
  });

  it("does not create a pub route when a planning tool receives a late-food request", async () => {
    const response = await runAskTool("propose_plan", { query: "Plan four pubs in Soho" }, {
      cityId: "london", query: "Food at 01:00 on 2026-10-23 near Soho",
      now: OCTOBER_REVIEW_NOW, skipModel: true, fetchImpl: offlineFetch,
    });
    expect(response.cards.map((card) => card.title)).toEqual(["Balans No.60"]);
    expect(response.cards.every((card) => card.venueId === "" && card.price === null)).toBe(true);
    expect(response.proposals).toEqual([]);
    expect(response.provenance).toContainEqual(expect.objectContaining({ url: SOHO_HOURS_SOURCE }));
  });

  it("keeps the tool query authoritative when model arguments name another place", async () => {
    const response = await runAskTool("search_venues", { query: "Food at 01:00 on 2026-10-23 near Victoria" }, {
      cityId: "london", query: "Food at 01:00 on 2026-10-23 near Soho",
      now: OCTOBER_REVIEW_NOW, skipModel: true, fetchImpl: offlineFetch,
    });
    expect(response.cards.map((card) => card.title)).toEqual(["Balans No.60"]);
    expect(response.cards[0]).toMatchObject({ venueId: "", price: null });
    expect(response.provenance).toContainEqual(expect.objectContaining({ url: SOHO_HOURS_SOURCE }));
    expect(response.proposals).toEqual([]);
  });
});


describe("late-food clarification context", () => {
  it.each(["Vegan", "Halal", "Kosher", "Gluten-free", "Dairy-free", "Sandwiches", "Breakfast", "Snacks"])("retains a separate %s requirement after an area correction", async (constraint) => {
    const turns = [{ role: "user" as const, content: `Food in Victoria tonight at 1am. ${constraint} please, close to the tube` }];
    const query = "Soho?";
    const typed = await runAsk({ query, turns, now: OCTOBER_REVIEW_NOW, cityId: "london", skipModel: true, fetchImpl: offlineFetch });
    const voice = await runAskTool("search_venues", {}, {
      query: resolvePubPalToolQuery({ turnQuery: query, args: {}, turns }),
      cityId: "london", now: OCTOBER_REVIEW_NOW, skipModel: true, fetchImpl: offlineFetch,
    });
    for (const response of [typed, voice]) {
      expect(response.cards).toEqual([]);
      expect(response.proposals).toEqual([]);
      expect("sources" in response ? response.sources : response.provenance).toEqual([]);
      expect("answer" in response ? response.answer : response.answerHint).toMatch(/no current.*record/i);
    }
  });

  it.each([
    { previous: "Food in Soho at 01:00 on 2026-10-26", query: "midnight please", now: Date.parse("2026-10-25T18:00:00.000Z"), names: ["Balans No.60"] },
    { previous: "Food in Soho at noon on 2026-10-23", query: "01:00 please", now: OCTOBER_REVIEW_NOW, names: ["Balans No.60"] },
    { previous: "Food in Soho at 01:00 on 2026-10-23", query: "noon please", now: OCTOBER_REVIEW_NOW, names: ["Balans No.60"] },
    { previous: "Food in Soho at 01:00 on 2026-10-26", query: "midnight and 01:00 please", now: OCTOBER_REVIEW_NOW, names: [] },
  ])("replaces every time representation during a correction: $query", async ({ previous, query, now, names }) => {
    const turns = [{ role: "user" as const, content: previous }];
    const typed = await runAsk({ query, turns, now, cityId: "london", skipModel: true, fetchImpl: offlineFetch });
    const voice = await runAskTool("search_venues", {}, {
      query: resolvePubPalToolQuery({ turnQuery: query, args: {}, turns }),
      cityId: "london", now, skipModel: true, fetchImpl: offlineFetch,
    });
    for (const response of [typed, voice]) {
      expect(response.cards.map((card) => card.title)).toEqual(names);
      expect(response.proposals).toEqual([]);
      if (names.length === 0) {
        expect("answer" in response ? response.answer : response.answerHint).toContain("Which night and time");
      }
    }
  });

  it.each(["sandwiches", "breakfast", "snacks", "lunch", "dinner", "supper", "burgers", "chips"])("retains restaurant and %s requirements through field corrections", async (food) => {
    for (const { previous, query } of [
      { previous: `Find restaurants serving ${food} in Victoria at 01:00 on 2026-11-07`, query: "Soho?" },
      { previous: `Find restaurants serving ${food} in Soho at 06:00 on 2026-11-07`, query: "01:00 please" },
      { previous: `Find restaurants serving ${food} in Soho at 01:00`, query: "2026-11-07 please" },
    ]) {
      const turns = [{ role: "user" as const, content: previous }];
      const typed = await runAsk({ query, turns, now: OCTOBER_REVIEW_NOW, cityId: "london", skipModel: true, fetchImpl: offlineFetch });
      const voice = await runAskTool("search_venues", {}, {
        query: resolvePubPalToolQuery({ turnQuery: query, args: {}, turns }),
        cityId: "london", now: OCTOBER_REVIEW_NOW, skipModel: true, fetchImpl: offlineFetch,
      });
      for (const response of [typed, voice]) {
        expect(response.cards).toEqual([]);
        expect(response.proposals).toEqual([]);
        expect("sources" in response ? response.sources : response.provenance).toEqual([]);
        expect("answer" in response ? response.answer : response.answerHint).toMatch(/no current.*record/i);
      }
    }
  });

  it.each([
    { query: "make it 2am", previous: "Food in Soho tonight at 06:00" },
    { query: "01:00", previous: "Food in Soho tonight at 06:00" },
    { query: "Soho", previous: "Food tonight at 1am" },
    { query: "2026-10-23", previous: "Food in Soho at 01:00" },
    { query: "01:00 please", previous: "Food in Soho tonight at 06:00" },
    { query: "Soho?", previous: "Food tonight at 1am" },
    { query: "2026-10-23 please", previous: "Food in Soho at 01:00" },
    { query: "01:00, please, thanks!", previous: "Food in Soho tonight at 06:00" },
    { query: "Soho, thanks!", previous: "Food tonight at 1am" },
    { query: "2026-10-23, thanks!", previous: "Food in Soho at 01:00" },
  ])("normalises the field-only reply in typed and voice requests: $query", async ({ query, previous }) => {
    const turns = [{ role: "user" as const, content: previous }];
    const typed = await runAsk({ query, turns, now: OCTOBER_REVIEW_NOW, cityId: "london", skipModel: true, fetchImpl: offlineFetch });
    const voice = await runAskTool("search_venues", {}, {
      query: resolvePubPalToolQuery({ turnQuery: query, args: {}, turns }),
      cityId: "london", now: OCTOBER_REVIEW_NOW, skipModel: true, fetchImpl: offlineFetch,
    });
    for (const response of [typed, voice]) {
      expect(response.cards.map((card) => card.title)).toEqual(["Balans No.60"]);
      expect(response.cards[0]).toMatchObject({ venueId: "", price: null });
      expect(response.proposals).toEqual([]);
    }
  });

  it.each(["Covent Garden?", "Covent Garden, thanks!", "Mayfair?"])("retains an area reply without food coverage: %s", async (query) => {
    const turns = [{ role: "user" as const, content: "Food tonight at 1am" }];
    const typed = await runAsk({ query, turns, now: OCTOBER_REVIEW_NOW, cityId: "london", skipModel: true, fetchImpl: offlineFetch });
    const voice = await runAskTool("search_venues", {}, {
      query: resolvePubPalToolQuery({ turnQuery: query, args: {}, turns }),
      cityId: "london", now: OCTOBER_REVIEW_NOW, skipModel: true, fetchImpl: offlineFetch,
    });
    for (const response of [typed, voice]) {
      expect(response.cards).toEqual([]);
      expect(response.proposals).toEqual([]);
      expect("answer" in response ? response.answer : response.answerHint).toContain("no current late-food record for");
    }
  });

  it.each(["burgers", "breakfast", "sandwiches"])("retains timed pub %s constraints after a correction", async (food) => {
    const turns = [{ role: "user" as const, content: `Find four pubs serving ${food} near Victoria tonight at 1am` }];
    const typed = await runAsk({ query: "Soho?", turns, now: OCTOBER_REVIEW_NOW, cityId: "london", skipModel: true, fetchImpl: offlineFetch });
    const voice = await runAskTool("search_venues", {}, {
      query: resolvePubPalToolQuery({ turnQuery: "Soho?", args: {}, turns }),
      cityId: "london", now: OCTOBER_REVIEW_NOW, skipModel: true, fetchImpl: offlineFetch,
    });
    for (const response of [typed, voice]) {
      expect(response.cards).toEqual([]);
      expect("answer" in response ? response.answer : response.answerHint).toContain("pub kitchen hours");
    }
  });

  it.each(["Chinese food", "Food that is Chinese", "Food with outdoor seating", "Food with Chinese options"])("retains an unrecorded constraint after an area correction: %s", async (food) => {
    const response = await runAsk({
      query: "Soho", now: OCTOBER_REVIEW_NOW, cityId: "london", skipModel: true, fetchImpl: offlineFetch,
      turns: [{ role: "user", content: `${food} near Victoria tonight at 1am` }],
    });
    expect(response.cards).toEqual([]);
    expect(response.sources).toEqual([]);
    expect(response.answer).toMatch(/no current.*record/i);
  });

  it.each([
    { previous: "Food after the pub near Victoria tonight at 1am", titles: [] },
    { previous: "Food from a pub near Victoria tonight at 1am", titles: [] },
    { previous: "Which pubs are serving food near Victoria tonight at 1am", titles: [] },
  ])("retains every pub requirement after an area correction: $previous", async ({ previous, titles }) => {
    const response = await runAsk({
      query: "Soho", now: OCTOBER_REVIEW_NOW, cityId: "london", skipModel: true, fetchImpl: offlineFetch,
      turns: [{ role: "user", content: previous }],
    });
    expect(response.cards.map((card) => card.title)).toEqual(titles);
  });

  it.each(["No trains tonight?", "No thanks", "Thanks!", "Please"])("keeps unrelated or declining replies authoritative: %s", (query) => {
    const turns = [{ role: "user" as const, content: "Food at 01:00 on 2026-10-23 near Soho" }];
    expect(resolveLateFoodQuery(query, turns)).toBe(query);
    expect(resolvePubPalToolQuery({ turnQuery: query, args: {}, turns })).toBe(query);
  });

  it("does not claim evidence for an unlisted free-from requirement", async () => {
    const response = await ask("Mustard-free food at 01:00 on 2026-10-23 near Soho");
    expect(response.cards).toEqual([]);
    expect(response.proposals).toEqual([]);
    expect(response.sources).toEqual([]);
    expect(response.answer).toMatch(/dietary|evidence/i);
  });

  it("retains food context when a user adds a lactose-free requirement", async () => {
    const response = await runAsk({
      query: "Lactose-free please", now: OCTOBER_REVIEW_NOW, cityId: "london", skipModel: true, fetchImpl: offlineFetch,
      turns: [{ role: "user", content: "Food at 01:00 on 2026-10-23 near Soho" }],
    });
    expect(response.cards).toEqual([]);
    expect(response.proposals).toEqual([]);
    expect(response.sources).toEqual([]);
    expect(response.answer).toMatch(/dietary|evidence/i);
  });

  it("retains dietary constraints inside the old area clause after a location correction", async () => {
    const response = await runAsk({
      query: "Actually near Soho at 01:00", now: OCTOBER_REVIEW_NOW, cityId: "london", skipModel: true, fetchImpl: offlineFetch,
      turns: [{ role: "user", content: "Food near Victoria that is vegan at 06:00 on 2026-10-30" }],
    });
    expect(response.cards).toEqual([]);
    expect(response.proposals).toEqual([]);
    expect(response.answer).toMatch(/dietary|vegan|evidence/i);
  });

  it("retains typed food context across separate night and meridiem clock replies", async () => {
    const response = await runAsk({
      query: "1am", now: OCTOBER_REVIEW_NOW, cityId: "london", skipModel: true, fetchImpl: offlineFetch,
      turns: [
        { role: "user", content: "Food after midnight near Soho" },
        { role: "user", content: "tonight" },
      ],
    });
    expect(response.cards.map((card) => card.title)).toEqual(["Balans No.60"]);
    expect(response.cards[0]).toMatchObject({ venueId: "", price: null });
  });

  it("retains voice food context across separate night and meridiem clock replies", async () => {
    const turns = [
      { role: "user" as const, content: "Food after midnight near Soho" },
      { role: "user" as const, content: "tonight" },
    ];
    const query = resolvePubPalToolQuery({ turnQuery: "1am", args: {}, turns });
    const response = await runAskTool("search_venues", {}, {
      query, cityId: "london", now: OCTOBER_REVIEW_NOW, skipModel: true, fetchImpl: offlineFetch,
    });
    expect(response.cards.map((card) => card.title)).toEqual(["Balans No.60"]);
    expect(resolvePubPalToolQuery({ turnQuery: "1", args: {}, turns })).toBe("1");
  });

  it("uses a recent user food request when the user supplies the missing night and time", async () => {
    const response = await runAsk({
      query: "Tonight at 1am", now: OCTOBER_REVIEW_NOW, cityId: "london", skipModel: true, fetchImpl: offlineFetch,
      turns: [{ role: "user", content: "Food after midnight near Soho" }],
    });
    expect(response.cards.map((card) => card.title)).toEqual(["Balans No.60"]);
    expect(response.cards[0]).toMatchObject({ venueId: "", price: null });
  });

  it("uses the user's later area correction instead of the earlier closed area", async () => {
    const response = await runAsk({
      query: "Actually near Soho", now: OCTOBER_REVIEW_NOW, cityId: "london", skipModel: true, fetchImpl: offlineFetch,
      turns: [{ role: "user", content: "Food at 01:00 on 2026-10-23 near Victoria" }],
    });
    expect(response.cards.map((card) => card.title)).toEqual(["Balans No.60"]);
  });

  it("uses the user's later clock correction instead of the earlier closed time", async () => {
    const response = await runAsk({
      query: "Actually at 1am", now: OCTOBER_REVIEW_NOW, cityId: "london", skipModel: true, fetchImpl: offlineFetch,
      turns: [{ role: "user", content: "Food at 06:00 on 2026-10-23 near Soho" }],
    });
    expect(response.cards.map((card) => card.title)).toEqual(["Balans No.60"]);
  });

  it("retains a dietary requirement while the user supplies the missing time", async () => {
    const response = await runAsk({
      query: "Tonight at 1am", now: OCTOBER_REVIEW_NOW, cityId: "london", skipModel: true, fetchImpl: offlineFetch,
      turns: [{ role: "user", content: "Vegan food after midnight near Soho" }],
    });
    expect(response.cards).toEqual([]);
    expect(response.answer).toMatch(/dietary|vegan|evidence/i);
  });

  it("does not revive food intent across a later unrelated user request", async () => {
    const response = await runAsk({
      query: "Tonight at 1am", now: OCTOBER_REVIEW_NOW, cityId: "london", skipModel: true, fetchImpl: offlineFetch,
      turns: [
        { role: "user", content: "Food after midnight near Soho" },
        { role: "user", content: "Find four pubs in Camden" },
      ],
    });
    expect(response.cards.length).toBeGreaterThan(0);
    expect(response.cards.every((card) => card.venueId.startsWith("venue-"))).toBe(true);
  });

  it("gives voice tools the same user-owned food clarification without trusting model arguments", async () => {
    const query = resolvePubPalToolQuery({
      turnQuery: "Tonight at 1am", args: { query: "Food at 01:00 on 2026-10-23 near Victoria" },
      turns: [{ role: "user", content: "Food after midnight near Soho" }],
    });
    const response = await runAskTool("search_venues", {}, {
      query, cityId: "london", now: OCTOBER_REVIEW_NOW, skipModel: true, fetchImpl: offlineFetch,
    });
    expect(response.cards.map((card) => card.title)).toEqual(["Balans No.60"]);
  });

  it("preserves a later user area correction when a voice clarification supplies the time", async () => {
    const query = resolvePubPalToolQuery({
      turnQuery: "Tonight at 1am", args: {},
      turns: [
        { role: "user", content: "Food after midnight near Victoria" },
        { role: "user", content: "Actually near Soho" },
      ],
    });
    const response = await runAskTool("search_venues", {}, {
      query, cityId: "london", now: OCTOBER_REVIEW_NOW, skipModel: true, fetchImpl: offlineFetch,
    });
    expect(response.cards.map((card) => card.title)).toEqual(["Balans No.60"]);
  });

  it("does not use assistant or model text as the food intent behind an owned voice turn", async () => {
    const query = resolvePubPalToolQuery({
      turnQuery: "Tonight at 1am", args: { query: "Food at 01:00 on 2026-10-23 near Soho" },
      turns: [{ role: "assistant", content: "Food after midnight near Soho" }],
    });
    const response = await runAskTool("search_venues", {}, {
      query, cityId: "london", now: OCTOBER_REVIEW_NOW, skipModel: true, fetchImpl: offlineFetch,
    });
    expect(response.cards.length).toBeGreaterThan(0);
    expect(response.cards.every((card) => card.venueId.startsWith("venue-"))).toBe(true);
  });
});
