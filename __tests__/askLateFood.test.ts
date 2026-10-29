import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { composeAnswer, mergeToolResults, runAsk } from "@/lib/ask/runAsk";
import { runAskTool } from "@/lib/ask/tools";
import { resolveLateFoodQuery } from "@/lib/ask/lateFoodQuestion";
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
  ])("retains timed ordinary daytime discovery: %s", async (query) => {
    const response = await ask(query);
    expect(response.cards.length).toBeGreaterThan(0);
    expect(response.cards.every((card) => card.venueId.startsWith("venue-"))).toBe(true);
    expect(response.cards.some((card) => card.key.startsWith("late-food-evidence-"))).toBe(false);
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
  it.each(["No trains tonight?", "No thanks"])("keeps unrelated or declining replies authoritative: %s", (query) => {
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
