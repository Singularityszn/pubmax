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
  for (const key of ["ANTHROPIC_API_KEY", "TYPESAFE_API_KEY", "SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) {
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
  return {
    cards: result.cards, proposals: result.proposals,
    sources: result.sources, answerHint: result.answerHint,
  };
}

describe("clean late-food questions through Ask", () => {
  it.each([
    ["Chinese food in Soho tonight at 1am", "Chinese"],
    ["Chinese restaurant food in Soho tonight at 1am", "Chinese"],
    ["Food in Soho tonight at 1am. Find Chinese close to the tube.", "Chinese close to the tube"],
    ["Food in Soho tonight at 1am. Vegan please, close to the tube.", "Vegan please, close to the tube"],
    ["Food in Soho tonight at 1am. Directions to London Bridge from The Blackfriar.", "Directions to London Bridge from The Blackfriar"],
  ])("preserves an unverified food requirement instead of returning generic pubs: %s", async (query, requirement) => {
    const typed = await ask(query);
    const voice = await voiceAsk(query);
    for (const response of [typed, voice]) {
      expect(response.cards).toEqual([]);
      expect(response.proposals).toEqual([]);
      expect(response.sources).toEqual([]);
    }
    for (const answer of [typed.answer, voice.answerHint]) {
      expect(answer).toContain(requirement);
      expect(answer).toContain("1am");
      expect(answer).toMatch(/cannot confirm|no current.*record/i);
    }
  });

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
    "Food in Soho after ten pm",
    "Food in Soho tonight and tomorrow at 1am",
    "Food late in Soho tonight and tomorrow",
    "Food in Soho tonight tonight at 1am",
    "Food in Soho tonight at 01:00 and 02:00",
    "Food in Soho at midnight and 01:00 on 2026-10-26",
    "Food in Soho at noon on 2026-10-23",
    "Food in Soho tomorrow",
    "Food in Soho tonight at 25:00",
    "Food in Soho tonight at 1",
    "Food at 01:00 on 2026-10-23 and 2026-10-24 near Soho",
    "Food at 01:00 on 2026-02-30 near Soho",
    "Food in Soho before 1am",
    "Food in Soho after 1am",
    "Food after the pub in Soho tonight at 1am",
  ])("requests an exact night and time for a clean question: %s", async (query) => {
    const response = await ask(query);
    expect(response.cards).toEqual([]);
    expect(response.proposals).toEqual([]);
    expect(response.answer).toContain("Which night and time");
  });

  it.each(["Food tonight at 1am", "Food at 01:00 on 2026-10-23"])("asks for the area of a timed question with none: %s", async (query) => {
    const response = await ask(query);
    expect(response.cards).toEqual([]);
    expect(response.proposals).toEqual([]);
    expect(response.sources).toEqual([]);
    expect(response.answer).toBe("Which area do you want food in?");
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
    "Directions to London Bridge from The Blackfriar. Vegan food at 01:00 on 2026-10-23 near Soho",
    "Food in Soho on Friday",
    "Food in Soho at an unknown time",
    "Food at The Devonshire in Soho",
    "Food at The Devonshire in Soho at an unknown time",
    "Food in Atlantis tonight at 1am",
    "Food near Soho and near Victoria tonight at 1am",
    "Food at 01:00 on 2026-10-23 near Soho, actually near Victoria",
    ...["sandwiches", "breakfast", "snacks", "lunch", "dinner", "supper", "burgers"].map((food) => `Find restaurants serving ${food} in Soho tonight at 1am`),
    "Find cafes and restaurants in Soho tonight at 1am",
  ])("returns control to main without intercepting: %s", (query) => {
    expect(answerLateFoodQuestion({ query, cityId: "london", now: OCTOBER_REVIEW_NOW })).toBeNull();
  });

  it.each([
    "Food at The Devonshire in Soho tonight at 1am",
    "Find four pubs with food in Soho tonight at 23:00",
    "Which pubs are serving food in Soho tonight at 1am",
    "Food with outdoor seating in Soho tonight at 1am",
    "Find restaurants serving chips in Soho tonight at 1am",
    ...["Halal", "Kosher", "Dairy-free", "Nut-free", "Mustard-free"].map((food) => `${food} food in Soho tonight at 1am`),
  ])("does not discard unverified requirements from a timed food request: %s", (query) => {
    const response = answerLateFoodQuestion({ query, cityId: "london", now: OCTOBER_REVIEW_NOW });
    expect(response).toMatchObject({ ok: false, cards: [], proposals: [], provenance: [] });
    expect(response?.answerHint).toContain(query);
    expect(response?.answerHint).toMatch(/no current.*record/i);
  });

  it.each([
    "Find four pubs with food in Soho",
  ])("preserves ordinary pub discovery for the narrowed case: %s", async (query) => {
    const response = await ask(query, Date.parse("2026-11-07T18:00:00.000Z"));
    expect(response.cards.length).toBeGreaterThan(0);
    expect(response.cards.every((card) => card.venueId.startsWith("venue-"))).toBe(true);
    expect(response.sources).not.toContainEqual(expect.objectContaining({ url: SOHO_HOURS_SOURCE }));
    expect(response.answer).not.toContain("Which night and time");
  });

  it("preserves main's named-pub prompt for a place after at", async () => {
    const response = await ask("Food at The Devonshire in Soho", Date.parse("2026-11-07T18:00:00.000Z"));
    expect(response.answer).toBe("Name a listed pub and I'll read back what people have logged there.");
    expect(response.toolsUsed).toEqual(["venue_drinks"]);
    expect(response.cards).toEqual([]);
    expect(response.proposals).toEqual([]);
    expect(response.sources).toEqual([]);
  });
});

describe("clean late-food clarification context", () => {
  it.each([
    "Food in Soho tonight and tomorrow at 1am",
    "Food in Soho tonight and today at 1am",
    "Food in Soho tomorrow at 1am",
    "Food in Soho at 1am on 2026-10-23 and 2026-10-24",
  ])("preserves unresolved days when only the clock changes: %s", async (previous) => {
    const turns = [{ role: "user" as const, content: previous }];
    for (const query of ["2am", "at 02:00"]) {
      const typed = await runAsk({ query, turns, now: OCTOBER_REVIEW_NOW, cityId: "london", skipModel: true, fetchImpl: offlineFetch });
      const voice = await voiceAsk(query, turns);
      for (const response of [typed, { ...voice, answer: voice.answerHint }]) {
        expect(response.cards).toEqual([]);
        expect(response.proposals).toEqual([]);
        expect(response.sources).toEqual([]);
        expect(response.answer).toContain("Which night and time");
      }
    }
  });

  it.each([
    { query: "Food tonight at 1am", history: ["Find quiet pubs in Soho", "Hi"] },
    { query: "Food tonight at 1am", history: ["Find quiet pubs in Soho", "Thanks"] },
    { query: "Find food tonight at 1am", history: ["Find quiet pubs in Soho"] },
  ])("asks for an area when general refinement cannot supply one: $query $history", async ({ query, history }) => {
    const turns = history.map((content) => ({ role: "user" as const, content }));
    const typed = await runAsk({ query, turns, now: OCTOBER_REVIEW_NOW, cityId: "london", skipModel: true, fetchImpl: offlineFetch });
    const voice = await voiceAsk(query, turns);
    for (const response of [typed, { ...voice, answer: voice.answerHint }]) {
      expect(response.cards).toEqual([]);
      expect(response.proposals).toEqual([]);
      expect(response.sources).toEqual([]);
      expect(response.answer).toBe("Which area do you want food in?");
    }
  });

  it.each([
    { query: "make it 2am", previous: "Food in Soho tonight at 06:00" },
    { query: "01:00", previous: "Food in Soho tonight at 06:00" },
    { query: "01:00 please", previous: "Food in Soho tonight at 06:00" },
    { query: "01:00, please, thanks!", previous: "Food in Soho tonight at 06:00" },
    { query: "2026-10-23 please", previous: "Food in Soho at 01:00" },
    { query: "Soho?", previous: "Food near Victoria tonight at 1am" },
    { query: "Tonight at 1am", previous: "Food after midnight near Soho" },
    { query: "Soho?", previous: "Food tonight at 1am" },
    { query: "2026-10-23", previous: "Food at 01:00 near Soho" },
    { query: "Tonight at 1am", previous: "Food near Soho after ten pm" },
    { query: "Tonight at 1am", previous: "Food in Soho tonight and tomorrow at 1am" },
    { query: "on 2026-10-23", previous: "Food in Soho tonight and tomorrow at 1am" },
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
    "Find restaurants serving sandwiches near Victoria tonight at 1am",
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

  it("keeps asking for a clear time after an area reply", async () => {
    const response = await runAsk({
      query: "Soho?", now: OCTOBER_REVIEW_NOW, cityId: "london", skipModel: true, fetchImpl: offlineFetch,
      turns: [{ role: "user", content: "Food near Victoria after ten pm" }],
    });
    expect(response.cards).toEqual([]);
    expect(response.answer).toContain("Which night and time");
  });

  it.each([
    ["Food near Victoria tonight at 1am. Find Chinese close to the tube.", "Chinese close to the tube"],
    ["Chinese food near Victoria tonight at 1am", "Chinese"],
    ["Food at The Devonshire near Victoria tonight at 1am", "The Devonshire"],
  ])("retains an unverified requirement during an area correction: %s", async (previous, requirement) => {
    const query = "Soho?";
    const turns = [{ role: "user" as const, content: previous }];
    const typed = await runAsk({ query, turns, now: OCTOBER_REVIEW_NOW, cityId: "london", skipModel: true, fetchImpl: offlineFetch });
    const voice = await voiceAsk(query, turns);
    for (const response of [typed, voice]) {
      expect(response.cards).toEqual([]);
      expect(response.proposals).toEqual([]);
      expect(response.sources).toEqual([]);
    }
    for (const answer of [typed.answer, voice.answerHint]) {
      expect(answer).toContain(requirement);
      expect(answer).toContain("near Soho");
      expect(answer).toContain("1am");
      expect(answer).toMatch(/no current.*record/i);
    }
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

  it.each([
    ["Food after midnight near Victoria", "Actually near Soho", "tonight"],
    ["Food after midnight near Soho", "on 2026-10-23"],
  ])("retains a clean question across separate supported field replies: %s", async (...earlier) => {
    const turns = earlier.map((content) => ({ role: "user" as const, content }));
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

describe("late tonight wording", () => {
  const FIRST = "Where can I get food late in Soho tonight?";
  const MONDAY_NOW = Date.parse("2026-11-09T18:00:00.000Z");

  async function bothPaths(query: string, history: string[], now = OCTOBER_REVIEW_NOW) {
    vi.setSystemTime(new Date(now));
    const turns = history.map((content) => ({ role: "user" as const, content }));
    const typed = await runAsk({ query, turns, now, cityId: "london", skipModel: true, fetchImpl: offlineFetch });
    const voice = await voiceAsk(query, turns);
    return [typed, { ...voice, answer: voice.answerHint }];
  }

  it.each([
    "Food late in Soho",
    "Late food in Soho",
    "Where can I get late food in Soho?",
    "Food late night in Soho",
    "Food late-night in Soho",
  ])(
    "checks 23:00 tonight when late food omits the night: %s", async (query) => {
      for (const response of await bothPaths(query, [])) {
        expect(response.cards).toEqual([expect.objectContaining({ title: "Balans No.60", venueId: "", price: null })]);
        expect(response.proposals).toEqual([]);
        expect(response.sources).toContainEqual(expect.objectContaining({ url: SOHO_HOURS_SOURCE }));
        expect(response.answer).toContain("I checked 23:00 tonight.");
      }
    },
  );

  it("reads late tonight as 23:00 instead of asking for the night and time", async () => {
    for (const response of await bothPaths(FIRST, [])) {
      expect(response.cards).toEqual([expect.objectContaining({ title: "Balans No.60", venueId: "", price: null })]);
      expect(response.answer).toContain("23:00 tonight");
      expect(response.answer).not.toContain("Which night and time");
    }
  });

  it.each([
    "Food late in Soho on 2026-10-23",
    "Food late in Soho tomorrow",
    "Food late in Soho today",
    "Food late in Soho at 1am",
  ])("does not infer tonight beside another day or clock: %s", async (query) => {
    for (const response of await bothPaths(query, [])) {
      expect(response.cards).toEqual([]);
      expect(response.proposals).toEqual([]);
      expect(response.sources).toEqual([]);
      expect(response.answer).toContain("Which night and time");
    }
  });

  it.each(["What about after midnight?", "How about after midnight"])(
    "keeps the food question on a follow-up: %s", async (query) => {
      for (const previous of [FIRST, "Food late in Soho"]) {
        for (const response of await bothPaths(query, [previous])) {
          expect(response.cards).toEqual([expect.objectContaining({ title: "Balans No.60", venueId: "", price: null })]);
          expect(response.answer).toContain("I checked 01:00 tonight.");
          expect(response.sources).toContainEqual(expect.objectContaining({ url: SOHO_HOURS_SOURCE }));
        }
      }
    },
  );

  it.each(["after midnight", "What about after midnight tonight?", "How about after midnight tonight?"])(
    "replaces an earlier clock with after-midnight service: %s", async (query) => {
      for (const previous of ["Food in Soho tonight at 11pm", FIRST]) {
        for (const response of await bothPaths(query, [previous])) {
          expect(response.cards).toEqual([expect.objectContaining({ title: "Balans No.60", venueId: "", price: null })]);
          expect(response.proposals).toEqual([]);
          expect(response.answer).toContain("01:00 tonight");
          expect(response.sources).toContainEqual(expect.objectContaining({ url: SOHO_HOURS_SOURCE }));
        }
      }
    },
  );

  it.each(["tonight", "What about tonight?", "How about tonight?"])(
    "preserves after-midnight service in a night-only reply: %s", async (query) => {
      for (const response of await bothPaths(query, ["Food after midnight near Soho"])) {
        expect(response.cards).toEqual([expect.objectContaining({ title: "Balans No.60", venueId: "", price: null })]);
        expect(response.proposals).toEqual([]);
        expect(response.answer).toContain("01:00 tonight");
        expect(response.sources).toContainEqual(expect.objectContaining({ url: SOHO_HOURS_SOURCE }));
      }
    },
  );

  it.each(["1am", "What about 1am?", "Tonight at 1am", "01:00 please"])(
    "replaces the earlier time wording with a clock: %s", async (query) => {
      for (const history of [[FIRST], [FIRST, "What about after midnight?"]]) {
        for (const response of await bothPaths(query, history)) {
          expect(response.cards).toEqual([expect.objectContaining({ title: "Balans No.60", venueId: "", price: null })]);
          expect(response.proposals).toEqual([]);
          expect(response.sources).toContainEqual(expect.objectContaining({ url: SOHO_HOURS_SOURCE }));
        }
      }
    },
  );

  it.each(["2026-10-23", "on 2026-10-23 please"])(
    "asks for a clear time after a date-only correction: %s", async (query) => {
      for (const history of [[FIRST], [FIRST, "What about after midnight?"]]) {
        for (const response of await bothPaths(query, history)) {
          expect(response.cards).toEqual([]);
          expect(response.proposals).toEqual([]);
          expect(response.sources).toEqual([]);
          expect(response.answer).toContain("Which night and time");
        }
        for (const response of await bothPaths("1am", [...history, query])) {
          expect(response.cards).toEqual([expect.objectContaining({ title: "Balans No.60", venueId: "", price: null })]);
        }
      }
    },
  );

  it.each([
    "Food in Soho tonight and tomorrow at 1am",
    "Food in Soho tonight and today at 1am",
    "Food late in Soho tonight and tomorrow",
    "Food late in Soho tonight and today",
  ])("preserves unresolved nights after an after-midnight reply: %s", async (previous) => {
    for (const response of await bothPaths("after midnight", [previous])) {
      expect(response.cards).toEqual([]);
      expect(response.proposals).toEqual([]);
      expect(response.sources).toEqual([]);
      expect(response.answer).toContain("Which night and time");
    }
  });

  it("answers both turns honestly on a night with no recorded late service", async () => {
    for (const [query, history, time] of [[FIRST, [], "23:00"], ["What about after midnight?", [FIRST], "01:00"]] as const) {
      for (const response of await bothPaths(query, [...history], MONDAY_NOW)) {
        expect(response.cards).toEqual([]);
        expect(response.proposals).toEqual([]);
        expect(response.answer).toContain(`${time} tonight`);
        expect(response.answer).toMatch(/no current record of food service/i);
      }
    }
  });
});
