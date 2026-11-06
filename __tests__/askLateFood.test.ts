import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runAsk } from "@/lib/ask/runAsk";
import { resolveLateFoodQuery } from "@/lib/ask/lateFoodQuestion";
import { answerLateFoodQuestion } from "@/lib/ask/lateFoodAnswer.server";
import { invokePubPalAskTool, resolvePubPalToolQuery } from "@/lib/pubPalToolInvoke.server";
import { __resetPubPalToolTurnStore, registerPubPalToolTurn } from "@/lib/pubPalToolTurnStore";
import { offlineFetch } from "@/evals/pal/offlineFetch";

const OCTOBER_REVIEW_NOW = Date.parse("2026-10-22T18:00:00.000Z");
const SOHO_HOURS_SOURCE = "https://balans.co.uk/locations/soho-no-60/";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(OCTOBER_REVIEW_NOW));
  __resetPubPalToolTurnStore();
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
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  }
});

async function ask(query: string, now = OCTOBER_REVIEW_NOW, cityId = "london") {
  return runAsk({ query, now, cityId, skipModel: true, fetchImpl: offlineFetch });
}

async function voiceAsk(query: string, turns: { role: "user" | "assistant"; content: string }[] = [], toolName = "search_venues") {
  const conversationId = "conv_latefoodask01";
  await registerPubPalToolTurn(conversationId, {
    query, turns, cityId: "london", ownerId: "11111111-1111-4111-8111-111111111111",
  });
  const { result } = await invokePubPalAskTool({
    toolName, args: { query: "Plan four pubs in Victoria" }, conversationId,
  });
  return result;
}

describe("clean late-food questions through Ask", () => {
  it.each([
    { query: "Food at 01:00 on 2026-10-23 near Soho", now: OCTOBER_REVIEW_NOW },
    { query: "Food at 01:00 on 2026-10-30 near Soho", now: Date.parse("2026-10-29T18:00:00.000Z") },
    { query: "Where can I eat in Soho tonight at 1am?", now: OCTOBER_REVIEW_NOW },
    { query: "Food in Soho tonight 1am", now: OCTOBER_REVIEW_NOW },
    { query: "Food in Soho 01:00 on 2026-10-23", now: OCTOBER_REVIEW_NOW },
    { query: "Find restaurants in Soho at 01:00 on 2026-11-07", now: OCTOBER_REVIEW_NOW },
  ])("returns the recorded overnight service: $query", async ({ query, now }) => {
    const response = await ask(query, now);
    expect(response.cards).toHaveLength(1);
    expect(response.cards[0]).toMatchObject({
      key: "late-food-evidence-piccadilly-soho-balans-no-60",
      title: "Balans No.60", venueId: "", price: null,
    });
    expect(response.cards[0]?.note).toMatch(/04:30/);
    expect(response.cards[0]?.note).toMatch(/check|confirm|verify/i);
    expect(response.proposals).toEqual([]);
    expect(response.sources).toContainEqual(expect.objectContaining({ url: SOHO_HOURS_SOURCE }));
    expect(response.sources.some((source) => source.label.includes("2026-10-17"))).toBe(true);
  });

  it.each(["food", "eat", "eating", "meal", "meals", "kitchen", "somewhere to eat"])("keeps generic %s wording", async (food) => {
    const response = await ask(`Find restaurants with ${food} in Soho at 01:00 on 2026-11-07`);
    expect(response.cards.map((card) => card.title)).toEqual(["Balans No.60"]);
  });

  it.each([
    "Food after midnight near Soho",
    "Food in Soho tonight",
    "Food in Soho at 01:00",
  ])("requests an exact night and time for a clean question: %s", async (query) => {
    const response = await ask(query);
    expect(response.cards).toEqual([]);
    expect(response.proposals).toEqual([]);
    expect(response.answer).toContain("Which night and time");
  });

  it.each([
    "Food at 01:00 on 2026-10-23 near Covent Garden",
    "Food at 01:00 on 2026-10-23 near Mayfair",
  ])("explains missing area coverage: %s", async (query) => {
    const response = await ask(query);
    expect(response.cards).toEqual([]);
    expect(response.proposals).toEqual([]);
    expect(response.sources).toEqual([]);
    expect(response.answer).toMatch(/no current late-food record/i);
  });

  it.each([
    { query: "Food at 06:00 on 2026-10-23 near Soho", now: OCTOBER_REVIEW_NOW },
    { query: "Food at 01:00 on 2026-10-23 near Victoria", now: OCTOBER_REVIEW_NOW },
    { query: "Food at 01:00 on 2026-10-23 near Shoreditch", now: OCTOBER_REVIEW_NOW },
    { query: "Food in Soho tonight at 1am", now: Date.parse("2026-10-25T18:00:00.000Z") },
    { query: "Food at 01:00 on 2026-11-20 near Soho", now: OCTOBER_REVIEW_NOW },
    { query: "Food at 01:00 on 2026-11-20 near Soho", now: Date.parse("2026-11-17T18:00:00.000Z") },
  ])("does not recommend closed or expired service: $query", async ({ query, now }) => {
    const response = await ask(query, now);
    expect(response.cards).toEqual([]);
    expect(response.proposals).toEqual([]);
    expect(response.sources).toEqual([]);
  });

  it.each([
    { before: "00:29", close: "00:30", day: "2026-10-26", now: Date.parse("2026-10-25T18:00:00.000Z") },
    { before: "04:29", close: "04:30", day: "2026-10-23", now: OCTOBER_REVIEW_NOW },
  ])("uses an exclusive closing boundary on $day", async ({ before, close, day, now }) => {
    const open = await ask(`Food at ${before} on ${day} near Soho`, now);
    const closed = await ask(`Food at ${close} on ${day} near Soho`, now);
    expect(open.cards.map((card) => card.title)).toEqual(["Balans No.60"]);
    expect(closed.cards).toEqual([]);
  });

  it.each(["Vegan food", "Vegetarian restaurant food", "Gluten-free pizza", "Kebabs", "Cafés"])("filters supported evidence fields for %s", async (food) => {
    const query = `${food} at 01:00 on 2026-10-23 near Soho`;
    expect(answerLateFoodQuestion({ query, cityId: "london", now: OCTOBER_REVIEW_NOW })).not.toBeNull();
    const response = await ask(query);
    expect(response.cards).toEqual([]);
    expect(response.proposals).toEqual([]);
    expect(response.sources).toEqual([]);
  });

  it("does not use London service records for another city", async () => {
    const response = await ask("Food at 01:00 on 2026-10-23 near Soho", OCTOBER_REVIEW_NOW, "manchester");
    expect(response.cards).toEqual([]);
    expect(response.sources).toEqual([]);
  });

  it.each(["search_venues", "propose_plan"])("keeps user-owned evidence in the %s tool", async (name) => {
    const response = await voiceAsk("Food at 01:00 on 2026-10-23 near Soho", [], name);
    expect(response.cards).toEqual([expect.objectContaining({ title: "Balans No.60", venueId: "", price: null })]);
    expect(response.proposals).toEqual([]);
    expect(response.sources).toContainEqual(expect.objectContaining({ url: SOHO_HOURS_SOURCE }));
  });
});

describe("requests outside the agreed late-food parser", () => {
  it("does not intercept an area added by main's general refinement", async () => {
    const response = await runAsk({
      query: "Food tonight at 1am", turns: [{ role: "user", content: "Find quiet pubs in Soho" }],
      now: OCTOBER_REVIEW_NOW, cityId: "london", skipModel: true, fetchImpl: offlineFetch,
    });
    expect(response.cards.length).toBeGreaterThan(0);
    expect(response.cards.every((card) => card.venueId.startsWith("venue-"))).toBe(true);
    expect(response.answer).not.toContain("Which night and time");
    expect(response.sources).not.toContainEqual(expect.objectContaining({ url: SOHO_HOURS_SOURCE }));
  });
  it.each([
    "Food tonight at 1am",
    "Chinese food in Soho tonight at 1am",
    "Chinese restaurant food in Soho tonight at 1am",
    "Food in Soho tonight at 1am. Find Chinese close to the tube.",
    "Food in Soho tonight at 1am. Vegan please, close to the tube",
    "Directions to London Bridge from The Blackfriar. Vegan food at 01:00 on 2026-10-23 near Soho",
    "Food in Soho tonight at 1am. Directions to London Bridge from The Blackfriar",
    "Food in Soho after ten pm",
    "Food in Soho tonight and tomorrow at 1am",
    "Food in Soho tonight tonight at 1am",
    "Food in Soho tonight at 01:00 and 02:00",
    "Food in Soho at midnight and 01:00 on 2026-10-26",
    "Food in Soho at noon on 2026-10-23",
    "Food in Soho on Friday",
    "Food in Soho tomorrow",
    "Late food in Soho",
    "Food in Soho tonight at 25:00",
    "Food in Soho tonight at 1",
    "Food in Soho at an unknown time",
    "Food at The Devonshire in Soho",
    "Food at The Devonshire in Soho tonight at 1am",
    "Food at The Devonshire in Soho at an unknown time",
    "Food in Atlantis tonight at 1am",
    "Food near Soho and near Victoria tonight at 1am",
    "Food at 01:00 on 2026-10-23 near Soho, actually near Victoria",
    "Food at 01:00 on 2026-10-23 and 2026-10-24 near Soho",
    "Food at 01:00 on 2026-02-30 near Soho",
    "Food in Soho before 1am",
    "Food in Soho after 1am",
    "Find four pubs with food in Soho tonight at 23:00",
    "Which pubs are serving food in Soho tonight at 1am",
    "Food after the pub in Soho tonight at 1am",
    "Food with outdoor seating in Soho tonight at 1am",
    ...["sandwiches", "breakfast", "snacks", "lunch", "dinner", "supper", "burgers", "chips"].map((food) => `Find restaurants serving ${food} in Soho tonight at 1am`),
    ...["Halal", "Kosher", "Dairy-free", "Nut-free", "Mustard-free"].map((food) => `${food} food in Soho tonight at 1am`),
    "Find cafes and restaurants in Soho tonight at 1am",
  ])("returns control to main without intercepting: %s", (query) => {
    expect(answerLateFoodQuestion({ query, cityId: "london", now: OCTOBER_REVIEW_NOW })).toBeNull();
  });

  it.each([
    "Food in Soho after ten pm",
    "Food in Soho tonight and tomorrow at 1am",
    "Chinese food in Soho tonight at 1am",
    "Food in Soho tonight at 1am. Find Chinese close to the tube.",
    "Find four pubs with food in Soho",
    "Food at The Devonshire in Soho",
  ])("preserves ordinary pub discovery for the narrowed case: %s", async (query) => {
    const response = await ask(query, Date.parse("2026-11-07T18:00:00.000Z"));
    expect(response.cards.length).toBeGreaterThan(0);
    expect(response.cards.every((card) => card.venueId.startsWith("venue-"))).toBe(true);
    expect(response.sources).not.toContainEqual(expect.objectContaining({ url: SOHO_HOURS_SOURCE }));
    expect(response.answer).not.toContain("Which night and time");
  });
});

describe("clean late-food clarification context", () => {
  it.each([
    { query: "make it 2am", previous: "Food in Soho tonight at 06:00" },
    { query: "01:00", previous: "Food in Soho tonight at 06:00" },
    { query: "01:00 please", previous: "Food in Soho tonight at 06:00" },
    { query: "01:00, please, thanks!", previous: "Food in Soho tonight at 06:00" },
    { query: "2026-10-23 please", previous: "Food in Soho at 01:00" },
    { query: "Soho?", previous: "Food near Victoria tonight at 1am" },
    { query: "Tonight at 1am", previous: "Food after midnight near Soho" },
  ])("merges a supported reply into a clean earlier question: $query", async ({ query, previous }) => {
    const turns = [{ role: "user" as const, content: previous }];
    const typed = await runAsk({ query, turns, now: OCTOBER_REVIEW_NOW, cityId: "london", skipModel: true, fetchImpl: offlineFetch });
    const voice = await voiceAsk(query, turns);
    for (const response of [typed, voice]) {
      expect(response.cards).toEqual([expect.objectContaining({ title: "Balans No.60", venueId: "", price: null })]);
      expect(response.proposals).toEqual([]);
    }
  });

  it.each([
    "Food tonight at 1am",
    "Chinese food near Victoria tonight at 1am",
    "Food near Victoria tonight at 1am. Vegan please, close to the tube",
    "Food near Victoria after ten pm",
    "Food near Victoria tonight and tomorrow at 1am",
    "Find restaurants serving sandwiches near Victoria tonight at 1am",
    "Food at The Devonshire near Victoria tonight at 1am",
  ])("does not merge context from a rejected earlier question: %s", (previous) => {
    const turns = [{ role: "user" as const, content: previous }];
    expect(resolveLateFoodQuery("Soho?", turns)).toBe("Soho?");
    expect(resolvePubPalToolQuery({ turnQuery: "Soho?", args: {}, turns })).toBe("Soho?");
  });

  it.each(["Chinese please", "midnight and 01:00 please", "01:00 and 02:00", "No trains tonight?", "No thanks", "Thanks!", "Please"])("keeps an unsupported or unrelated reply unchanged: %s", (query) => {
    const turns = [{ role: "user" as const, content: "Food after midnight near Soho" }];
    expect(resolveLateFoodQuery(query, turns)).toBe(query);
    expect(resolvePubPalToolQuery({ turnQuery: query, args: {}, turns })).toBe(query);
  });

  it("retains supported dietary requirements during an area correction", async () => {
    const response = await runAsk({
      query: "Soho?", now: OCTOBER_REVIEW_NOW, cityId: "london", skipModel: true, fetchImpl: offlineFetch,
      turns: [{ role: "user", content: "Vegan food near Victoria tonight at 1am" }],
    });
    expect(response.cards).toEqual([]);
    expect(response.sources).toEqual([]);
    expect(response.answer).toContain("dietary");
  });

  it("retains a clean question across separate supported field replies", async () => {
    const turns = [
      { role: "user" as const, content: "Food after midnight near Victoria" },
      { role: "user" as const, content: "Actually near Soho" },
      { role: "user" as const, content: "tonight" },
    ];
    const response = await voiceAsk("1am", turns);
    expect(response.cards).toEqual([expect.objectContaining({ title: "Balans No.60", venueId: "", price: null })]);
  });

  it("does not revive food context after a new topic or from assistant text", () => {
    for (const turns of [
      [{ role: "user", content: "Food after midnight near Soho" }, { role: "user", content: "Find four pubs in Camden" }],
      [{ role: "assistant", content: "Food after midnight near Soho" }],
    ]) {
      expect(resolveLateFoodQuery("Tonight at 1am", turns)).toBe("Tonight at 1am");
    }
  });
});
