import { CHAINED_ALCOHOL_FITNESS_QUESTIONS, QUANTITY_FITNESS_CASES } from "./fixtures/pubPalTemporalSafety";
import { VIBE_CHIPS } from "@/lib/vibeChips";
import { JOURNEY_ENDPOINT_REQUESTS, NAMED_QUALIFIED_PRICE_REQUESTS, NAMED_TERMINAL_PRICE_REQUESTS, QUALIFIED_PRICE_REQUESTS } from "./fixtures/askPriceSubjects";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetJourneyCache } from "@/lib/citymcp/client";
import { offlineFetch } from "@/evals/pal/offlineFetch";
import { NIGHT_AREAS } from "@/lib/nightAreas";
import { haversineKm } from "@/lib/haversine";
import { loadConciergeVenues } from "@/lib/concierge/venues.server";
import {
  enrichPubPalToolArgs,
  invokePubPalAskTool,
  resolvePubPalToolQuery,
} from "@/lib/pubPalToolInvoke.server";
import {
  __resetPubPalToolTurnStore,
  readPubPalToolTurn,
  registerPubPalToolTurn,
} from "@/lib/pubPalToolTurnStore";

const fence = vi.hoisted(() => ({ forceFenced: false }));
const store = vi.hoisted(() => ({ failAppend: false }));

vi.mock("@/lib/pubPalToolTurnStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/pubPalToolTurnStore")>();
  return {
    ...actual,
    appendPubPalToolTurn: async (
      ...args: Parameters<typeof actual.appendPubPalToolTurn>
    ) => {
      if (store.failAppend) throw new Error("pub_pal_tool_turns unavailable");
      return actual.appendPubPalToolTurn(...args);
    },
  };
});

vi.mock("@/lib/pubPalLlmFence", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/pubPalLlmFence")>();
  return {
    ...actual,
    resolvePubPalFenceIntent: async (
      ...args: Parameters<typeof actual.resolvePubPalFenceIntent>
    ) =>
      fence.forceFenced
        ? { fenced: true, sobrietyOnly: false }
        : actual.resolvePubPalFenceIntent(...args),
  };
});

describe("pubPal webhook arg resolution", () => {
  it("prefers the stored turn query over a short ElevenLabs fragment", () => {
    const query = resolvePubPalToolQuery({
      turnQuery: "What is the cheapest pint near Soho?",
      args: { query: "Soho" },
    });
    expect(query).toBe("What is the cheapest pint near Soho?");
  });

  it("enriches cheapest_pint_near from the full ask when only query is sent", () => {
    const args = enrichPubPalToolArgs(
      "cheapest_pint_near",
      { query: "Soho" },
      "What is the cheapest pint near Soho?",
    );
    expect(args.area === "Soho" || args.venueName === "Soho").toBe(true);
  });

  it("enriches propose_plan with the routed crawl ask", () => {
    const args = enrichPubPalToolArgs(
      "propose_plan",
      {},
      "Plan me a 3 pub crawl in Shoreditch tonight",
    );
    expect(args.query).toBe("Plan me a 3 pub crawl in Shoreditch tonight");
  });
});

describe("propose_plan over the Pal webhook", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", offlineFetch);
    delete process.env.TYPESAFE_API_KEY;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  });

  afterEach(() => {
    fence.forceFenced = false;
    store.failAppend = false;
    vi.restoreAllMocks();
    __resetPubPalToolTurnStore();
    vi.unstubAllGlobals();
  });

  it.each(QUANTITY_FITNESS_CASES.flatMap((entry) => (["current", "user", "assistant"] as const).map((role) => ({ ...entry, role }))))(
    "classifies numeric quantities in voice $role turns: $query", async ({ query, fenced, role }) => {
      const conversationId = "conv_quantityvoice01";
      await registerPubPalToolTurn(conversationId, {
        query: role === "current" ? query : "Find four quiet pubs in Soho",
        turns: role === "current" ? [] : [{ role, content: query }],
        cityId: "london", ownerId: "11111111-1111-4111-8111-111111111111",
      });
      const { result } = await invokePubPalAskTool({
        toolName: "search_venues", args: { query: "pubs in Soho" }, conversationId,
      });
      if (fenced && role !== "assistant") {
        expect(result).toMatchObject({
          ok: true, fenced: true, cards: [], proposals: [],
          answerHint: "I can't tell you whether to have another drink. Open Getting Home on the venue sheet for last-train times, ride links, and the TfL planner.",
        });
        expect((await readPubPalToolTurn(conversationId))?.cards).toEqual([]);
      } else {
        expect(result.fenced).not.toBe(true);
        expect(result.answerHint).not.toContain("Getting Home");
        if (role !== "current") expect(result.cards).toEqual(expect.arrayContaining([expect.objectContaining({ venueId: expect.any(String) })]));
      }
    },
  );

  it.each([
    ...CHAINED_ALCOHOL_FITNESS_QUESTIONS.flatMap((query) => [
      { conversationId: null, query },
      { conversationId: "conv_chainedsafety01", query },
      { conversationId: "conv_chainedhistory01", query },
    ]),
    { conversationId: null, query: "Where can I buy beer in Soho? How many pints can I have before driving?" },
    { conversationId: "conv_mixedsafety01", query: "Where can I buy beer in Soho? How many pints can I have before driving?" },
    { conversationId: null, query: "Where can I buy beer after cycling through Soho? Would it be safe to drive after two beers?" },
    { conversationId: "conv_temporalsafety01", query: "Where can I buy beer after cycling through Soho? Would it be safe to drive after two beers?" },
    { conversationId: null, query: "Can I drink 1.5 pints in Soho before driving?" },
    { conversationId: "conv_decimalsafety00", query: "Can I drink 1.5 pints in Soho before driving?" },
    { conversationId: null, query: "Would it be safe to drive after 1.5 pints?" },
    { conversationId: "conv_decimalsafety01", query: "Would it be safe to drive after 1.5 pints?" },
  ])("fences mixed discovery and alcohol allowance in voice tools: $conversationId $query", async ({ conversationId, query }) => {
    if (conversationId) {
      await registerPubPalToolTurn(conversationId, {
        query: conversationId === "conv_chainedhistory01" ? "What about Soho?" : query,
        turns: conversationId === "conv_chainedhistory01" ? [{ role: "user", content: query }] : [],
        cityId: "london", ownerId: "11111111-1111-4111-8111-111111111111",
      });
    }
    const { result } = await invokePubPalAskTool({
      toolName: "search_venues", args: { query: conversationId ? "beer in Soho" : query }, conversationId,
    });
    expect(result).toMatchObject({
      ok: true, fenced: true, cards: [], proposals: [],
      answerHint: "I can't tell you whether to have another drink. Open Getting Home on the venue sheet for last-train times, ride links, and the TfL planner.",
    });
    if (conversationId) {
      expect((await readPubPalToolTurn(conversationId))?.cards).toEqual([]);
      expect((await readPubPalToolTurn(conversationId))?.hints).toContain(result.answerHint);
    }
  });

  it("excludes chained alcohol questions from assistant history in voice tools", async () => {
    const query = CHAINED_ALCOHOL_FITNESS_QUESTIONS[0];
    if (query === undefined) throw new Error("A chained alcohol question fixture is required.");
    await registerPubPalToolTurn("conv_chainedassistant01", {
      query: "Find four quiet pubs in Soho", cityId: "london",
      ownerId: "11111111-1111-4111-8111-111111111111",
      turns: [{ role: "assistant", content: query }],
    });
    const { result } = await invokePubPalAskTool({
      toolName: "search_venues", args: { query: "pubs in Soho" }, conversationId: "conv_chainedassistant01",
    });
    expect(result.fenced).not.toBe(true);
    expect(result.cards).toEqual(expect.arrayContaining([expect.objectContaining({ venueId: expect.any(String) })]));
    expect(result.answerHint).not.toContain("I can't tell you whether to have another drink.");
  });

  it("uses the stored prior area for a budget refinement without rewriting its history", async () => {
    const query = "Same area, but under £6.30 a pint.";
    await registerPubPalToolTurn("conv_budgetfollow1", { query, cityId: "london", ownerId: "11111111-1111-4111-8111-111111111111",
      turns: [{ role: "user", content: "Find me four pubs in Soho and show them on the map." }, { role: "user", content: "Same area, but under £6.50 a pint." }],
    });
    const { result } = await invokePubPalAskTool({ toolName: "venue_prices", args: { query: "pints in Camden" }, conversationId: "conv_budgetfollow1" });
    expect(result.tool).toBe("search_venues");
    expect(result.cards).toEqual(expect.arrayContaining([expect.objectContaining({ venueId: "venue-e1srzr" })]));
    expect(result.cards).not.toEqual(expect.arrayContaining([expect.objectContaining({ venueId: "venue-15i2wst" })]));
    expect((await readPubPalToolTurn("conv_budgetfollow1"))?.query).toBe(query);
  });

  it.each(JOURNEY_ENDPOINT_REQUESTS)("preserves stored journey endpoints over provider rewrites: $query", async ({ query, from, to, venueId, name }) => {
    resetJourneyCache();
    const journeyFetch = vi.fn<typeof fetch>(async () => Response.json({ jsonrpc: "2.0", result: { structuredContent: { journeys: [{ durationMinutes: 12, legs: [] }] } } }));
    vi.stubGlobal("fetch", journeyFetch);
    await registerPubPalToolTurn("conv_endpointoriginal01", { query, cityId: "london", ownerId: "11111111-1111-4111-8111-111111111111" });
    const { result } = await invokePubPalAskTool({ toolName: "journey", args: { from: "Bank", to: "Fox", query: "Please show directions to Fox from Bank instead" }, conversationId: "conv_endpointoriginal01" });
    expect(result.cards).toMatchObject([{ venueId, place: name }]);
    expect(JSON.parse(journeyFetch.mock.calls[0]?.[1]?.body as string).params.arguments).toEqual({ from, to });
    expect((await readPubPalToolTurn("conv_endpointoriginal01"))?.toolsUsed).toEqual(["journey"]);
  });

  it.each(NAMED_QUALIFIED_PRICE_REQUESTS)("retains stored named prices across time qualifiers: $query", async ({ query, tool, category }) => {
    await registerPubPalToolTurn("conv_qualifiedoriginal01", { query, cityId: "london", ownerId: "11111111-1111-4111-8111-111111111111" });
    const { result } = await invokePubPalAskTool({ toolName: "cheapest_pint_near", args: { venueName: "The Lamb", query: "pints near The Lamb" }, conversationId: "conv_qualifiedoriginal01" });
    expect(result.tool).toBe(tool);
    expect(result.answerHint).toContain("Fox and Anchor");
    if (category) expect((result.priceEvidence as Array<{ category: string }>).filter((price) => price.category !== category)).toEqual([]);
    expect((await readPubPalToolTurn("conv_qualifiedoriginal01"))?.toolsUsed).toEqual([tool]);
  });

  it.each(NAMED_TERMINAL_PRICE_REQUESTS)("retains the stored named terminal price: %s", async (query) => {
    await registerPubPalToolTurn("conv_terminaloriginal01", { query, cityId: "london", ownerId: "11111111-1111-4111-8111-111111111111" });
    const { result } = await invokePubPalAskTool({ toolName: "cheapest_pint_near", args: { venueName: "The Lamb", query: "pints near The Lamb" }, conversationId: "conv_terminaloriginal01" });
    expect(result).toMatchObject({ tool: "venue_prices", ok: true });
    expect(result.answerHint).toContain("The Blackfriar");
    expect((await readPubPalToolTurn("conv_terminaloriginal01"))?.toolsUsed).toEqual(["venue_prices"]);
  });

  it.each([
    ["Pint price at The Lamb", "Please show the meal prices at The Lamb today", "venue_prices"],
    ["Cheapest pint in Camden", "Find the cheapest vegan curry available in Camden tonight", "cheapest_pint_near"],
    ["Wine prices at Fox and Anchor", "Please find bottles of Coke for me at The Lamb instead", "venue_drinks"],
  ])("lets the supported stored original control incompatible rewrites: %s", async (query, providerQuery, toolName) => {
    await registerPubPalToolTurn("conv_supportedoriginal01", { query, cityId: "london", ownerId: "11111111-1111-4111-8111-111111111111" });
    const { result } = await invokePubPalAskTool({ toolName: "venue_prices", args: { venueName: "The Lamb", query: providerQuery }, conversationId: "conv_supportedoriginal01" });
    expect(result).toMatchObject({ ok: true, tool: toolName });
    if (query.includes("Fox")) expect(result.answerHint).toContain("Fox and Anchor");
    expect((await readPubPalToolTurn("conv_supportedoriginal01"))?.toolsUsed).toEqual([toolName]);
  });

  it.each(["Directions to Fox and Anchor", "Directions to Fox & Anchor"])("keeps the stored journey destination over provider fragments: %s", async (query) => {
    resetJourneyCache();
    const journeyFetch = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      jsonrpc: "2.0", result: { structuredContent: { journeys: [{ durationMinutes: 12, legs: [] }] } },
    }), { headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", journeyFetch);
    await registerPubPalToolTurn("conv_completejourney01", { query, cityId: "london", ownerId: "11111111-1111-4111-8111-111111111111" });
    const { result } = await invokePubPalAskTool({
      toolName: "journey", args: { to: "Fox", query: "Directions to Fox" }, conversationId: "conv_completejourney01",
    });
    expect(result.cards).toMatchObject([{ venueId: "venue-phg4ss", place: "Fox and Anchor" }]);
    expect(JSON.parse(journeyFetch.mock.calls[0]?.[1]?.body as string).params.arguments.to).toBe("51.52042,-0.10071");
  });

  it.each(["Fox and Anchor", "Fox & Anchor", "The Black Friar, Blackfriars"])("keeps the stored named category over a provider pint query: %s", async (name) => {
    await registerPubPalToolTurn("conv_completecategory01", { query: `Wine prices at ${name}`, cityId: "london", ownerId: "11111111-1111-4111-8111-111111111111" });
    const { result } = await invokePubPalAskTool({
      toolName: "venue_prices", args: { venueName: "The Lamb", query: "pints at The Lamb" }, conversationId: "conv_completecategory01",
    });
    expect(result.tool).toBe("venue_drinks");
    expect(result.answerHint).toMatch(/wine prices|recorded wine/i);
    expect(result.answerHint).toContain(name.startsWith("The Black") ? "The Blackfriar" : "Fox and Anchor");
    expect((result.priceEvidence as Array<{ category: string }>).every((price) => price.category === "wine")).toBe(true);
  });

  it.each(QUALIFIED_PRICE_REQUESTS)("preserves qualified item fences with stored and provider questions: $query", async ({ query, code }) => {
    for (const conversationId of [null, "conv_qualifiedprice01"]) {
      if (conversationId) await registerPubPalToolTurn(conversationId, {
        query, cityId: "london", ownerId: "11111111-1111-4111-8111-111111111111",
      });
      const { result } = await invokePubPalAskTool({
        toolName: "cheapest_pint_near", args: { query: conversationId ? "pints in Soho" : query, area: "Soho" }, conversationId,
      });
      expect(result).toMatchObject({ ok: false, code, cards: [], proposals: [] });
    }
  });

  it.each(["quiet", "cheeky", "date"])("preserves %s discovery across stored and provider tool choices", async (id) => {
    const chip = VIBE_CHIPS.find((chip) => chip.id === id)!;
    for (const conversationId of [null, "conv_starterdiscovery01"]) {
      if (conversationId) await registerPubPalToolTurn(conversationId, {
        query: chip.ask, cityId: "london", ownerId: "11111111-1111-4111-8111-111111111111",
      });
      const { result } = await invokePubPalAskTool({
        toolName: id === "date" ? "venue_heritage" : "venue_prices",
        args: { query: conversationId ? "The Lamb" : chip.ask, venueName: "The Lamb" }, conversationId,
      });
      expect(result).toMatchObject({ ok: true, tool: "search_venues" });
      const cards = result.cards as Array<{ price: number; note: string }>;
      expect(cards.length).toBeGreaterThan(0);
      expect(result.priceEvidence).toHaveLength(cards.length);
      if (id === "cheeky") expect(cards.every((card) => card.price <= 6)).toBe(true);
      if (id === "quiet") expect(cards.some((card) => /calmer fit/i.test(card.note))).toBe(true);
      if (id === "date") expect(cards.some((card) => /calmer fit|date-night fit/i.test(card.note))).toBe(true);
    }
  });

  async function planFor(query: string) {
    const { result } = await invokePubPalAskTool({
      toolName: "propose_plan",
      args: { query },
      conversationId: null,
    });
    return result as {
      ok: boolean;
      cards: Array<{ venueId: string }>;
      proposals: Array<{ kind: string; stopIds?: string[] }>;
    };
  }

  it.each([false, true])("review regression: preserves independent status in provider/stored questions=%s", async (stored) => {
    const query = "Any tube delays and how much is a burger in Camden?";
    const conversationId = stored ? "conv_transitreview" : null;
    if (conversationId) await registerPubPalToolTurn(conversationId, { query, cityId: "london", ownerId: "transit-owner", turns: [] });
    const outcome = await invokePubPalAskTool({ toolName: "city_status", args: { query: stored ? "Tube delays" : query }, conversationId });
    expect(outcome.result.answerHint).toMatch(/transit|city status|tube|weather/i);
    expect(outcome.result.answerHint).not.toMatch(/meal prices/i);
    expect(outcome.result).toHaveProperty("tool", "city_status");
  });

  it.each([false, true])("preserves named category prices beside transit interrogatives in provider/stored questions=%s", async (stored) => {
    for (const [index, query] of [
      "Is the Tube running tonight and wine prices at Fox and Anchor?",
      "Wine prices at Fox and Anchor and are there Tube delays?",
    ].entries()) {
      const conversationId = stored ? `conv_transitcategory0${index}` : null;
      if (conversationId) await registerPubPalToolTurn(conversationId, { query, cityId: "london", ownerId: "transit-owner", turns: [] });
      const { result } = await invokePubPalAskTool({ toolName: "venue_prices", args: { query: stored ? "pints at The Lamb" : query, venueName: "The Lamb" }, conversationId });
      expect(result).toMatchObject({ tool: "venue_drinks", ok: true });
      expect(result.answerHint).toContain("Fox and Anchor");
      if (conversationId) expect((await readPubPalToolTurn(conversationId))?.toolsUsed).toEqual(["venue_drinks"]);
      const status = await invokePubPalAskTool({ toolName: "city_status", args: { query: stored ? "tube" : query }, conversationId });
      expect(status.result).toMatchObject({ tool: "city_status" });
      expect(status.result.answerHint).toMatch(/transit|city status|tube|weather/i);
    }
  });

  it.each([null, "conv_independent01"])("review regression: preserves independent webhook tools: %s", async (conversationId) => {
    const queries = [
      "Any tube delays and how much is a pint at The Lamb?",
      "Any tube delays and how much is wine at The Lamb?",
      "Find cheap drinks in Soho",
    ];
    for (const query of queries) {
      if (conversationId) {
        await registerPubPalToolTurn(conversationId, {
          query, cityId: "london", ownerId: "11111111-1111-4111-8111-111111111111",
        });
      }
      for (const toolName of ["city_status", "journey", "whats_on", "venue_heritage", "area_buzz", "propose_plan", "propose_map_action", "tonight_now", "find_desk", "report_occupancy"]) {
        const { result } = await invokePubPalAskTool({
          toolName, args: { query: conversationId ? "The Lamb" : query }, conversationId,
        });
        expect(result.tool).toBe(toolName);
      }
      if (conversationId) {
        const turn = await readPubPalToolTurn(conversationId);
        expect(turn?.toolsUsed).toContain("city_status");
        expect(turn?.toolsUsed).toContain("journey");
        expect(turn?.toolsUsed).not.toContain("venue_prices");
        expect(turn?.toolsUsed).not.toContain("venue_drinks");
      }
    }
  });

  it.each(["somewhere cheap and quiet", "Somewhere cheap in Soho"])("review regression: retains discovery constraints in a stored webhook question: %s", async (query) => {
    const conversationId = "conv_discovery01";
    await registerPubPalToolTurn(conversationId, {
      query, cityId: "london", ownerId: "11111111-1111-4111-8111-111111111111",
    });
    const { result } = await invokePubPalAskTool({ toolName: "search_venues", args: { query: "pubs" }, conversationId });
    expect(result).toMatchObject({ ok: true, tool: "search_venues" });
    expect((result.cards as Array<{ price: number }>).length).toBeGreaterThan(0);
    expect((result.cards as Array<{ price: number }>).every((card) => card.price <= 6)).toBe(true);
    expect(result.priceEvidence).toHaveLength((result.cards as unknown[]).length);
  });

  it.each([null, "conv_planningchip01"])("preserves the planning chip through provider and stored questions: %s", async (conversationId) => {
    const query = "Plan a big night for four of us, with cheap pints and a lively route";
    if (conversationId) {
      await registerPubPalToolTurn(conversationId, {
        query, cityId: "london", ownerId: "11111111-1111-4111-8111-111111111111",
      });
    }
    const { result } = await invokePubPalAskTool({
      toolName: "propose_plan", args: { query: conversationId ? "a lively route" : query }, conversationId,
    });
    expect(result).toMatchObject({ ok: true, tool: "propose_plan" });
    expect(result.cards).toHaveLength(3);
    expect(result.proposals).toContainEqual(expect.objectContaining({ kind: "draft_plan", query }));
    expect(result.priceEvidence).toHaveLength(3);
    if (conversationId) {
      const turn = await readPubPalToolTurn(conversationId);
      expect(turn?.toolsUsed).toEqual(["propose_plan"]);
      expect(turn?.proposals).toContainEqual(expect.objectContaining({ kind: "draft_plan", query }));
    }
  });

  it.each([
    ["Cheapest vegan food in Camden", "UNSUPPORTED_FOOD_PRICE_COMPARISON", /meal prices|dietary/i],
    ["Cheapest wine in Soho", "UNSUPPORTED_DRINK_PRICE_COMPARISON", /other drinks across pubs/i],
    ["Cheapest vegan curry in Camden", "UNSUPPORTED_PRICE_COMPARISON", /can compare listed pint prices/i],
    ["Cheapest Coke in Camden", "UNSUPPORTED_PRICE_COMPARISON", /can compare listed pint prices/i],
    ["Cheapest sparkling water in Camden", "UNSUPPORTED_PRICE_COMPARISON", /can compare listed pint prices/i],
    ["Cheapest pub lunch in Camden", "UNSUPPORTED_FOOD_PRICE_COMPARISON", /meal prices|dietary/i],
  ])("refuses provider-selected pint tools for %s using the full stored ask", async (query, code, wording) => {
    const conversationId = "conv_unsupported01";
    await registerPubPalToolTurn(conversationId, {
      query,
      cityId: "london",
      ownerId: "11111111-1111-4111-8111-111111111111",
    });
    const { result } = await invokePubPalAskTool({
      toolName: "cheapest_pint_near",
      args: { query: "Camden", area: "Camden" },
      conversationId,
    });
    expect(result).toMatchObject({ ok: false, code, cards: [], proposals: [] });
    expect(result.answerHint).toMatch(wording);
    const turn = await readPubPalToolTurn(conversationId);
    expect(turn?.cards).toEqual([]);
    expect(turn?.hints).toEqual([result.answerHint]);
    expect(turn?.toolsUsed).toEqual([]);
  });

  it("uses recorded drinks when the provider picks a pint tool for wine at one pub", async () => {
    const { result } = await invokePubPalAskTool({
      toolName: "cheapest_pint_near",
      args: { query: "Cheapest wine at The Lamb", venueName: "The Lamb" },
      conversationId: null,
    });
    expect(result.tool).toBe("venue_drinks");
    expect(result.answerHint).not.toMatch(/cheapest listed pints/i);
  });

  it("forwards typed pint evidence with the canonical price command", async () => {
    const conversationId = "conv_priceevidence01";
    const query = "Cheapest pint in Camden";
    await registerPubPalToolTurn(conversationId, {
      query,
      cityId: "london",
      ownerId: "11111111-1111-4111-8111-111111111111",
    });
    const { result } = await invokePubPalAskTool({
      toolName: "search_venues",
      args: { query: "Camden" },
      conversationId,
    });
    expect(result.tool).toBe("cheapest_pint_near");
    const evidence = result.priceEvidence as Array<{ cardKey: string; priceGbp: number }>;
    const cards = result.cards as Array<{ key: string; price: number }>;
    expect(evidence.length).toBeGreaterThan(0);
    for (const price of evidence) {
      expect(price).toMatchObject({
        kind: "listed-pint", category: "beer", source: "directory", serving: "pint", reportedAt: null,
      });
      expect(cards.find((card) => card.key === price.cardKey)?.price).toBe(price.priceGbp);
    }
    const turn = await readPubPalToolTurn(conversationId);
    expect(turn?.toolsUsed).toEqual(["cheapest_pint_near"]);
  });

  it("preserves generic area drink discovery and logs its actual venue-search command", async () => {
    const conversationId = "conv_genericdrinks01";
    const query = "Drink prices in Camden";
    await registerPubPalToolTurn(conversationId, {
      query, cityId: "london", ownerId: "11111111-1111-4111-8111-111111111111",
    });
    const { result } = await invokePubPalAskTool({
      toolName: "venue_prices", args: { query, venueName: "The Lamb" }, conversationId,
    });
    expect(result.tool).toBe("search_venues");
    expect((await readPubPalToolTurn(conversationId))?.toolsUsed).toEqual(["search_venues"]);
  });

  it.each([
    "How much is wine at The Eagle?",
    "Wine price at The Eagle",
    "What does wine cost at The Eagle?",
    "Wine prices at The Eagle",
    "Prices for wine at The Eagle",
    "Wine costs at The Eagle",
  ])("redirects a provider pint-price selection for %s to category prices", async (query) => {
    const { result } = await invokePubPalAskTool({
      toolName: "venue_prices",
      args: { query, venueName: "The Eagle" },
      conversationId: null,
    });
    expect(result.tool).toBe("venue_drinks");
    expect(result.tool).not.toBe("venue_prices");
    const cards = result.cards as Array<{ note?: string }>;
    for (const card of cards) expect(card.note).not.toMatch(/recorded pint|listed pint/i);
  });

  it("refuses a provider-selected pint price for an area burger question", async () => {
    const { result } = await invokePubPalAskTool({
      toolName: "venue_prices",
      args: { query: "How much is a burger in Camden?", venueName: "The Lamb" },
      conversationId: null,
    });
    expect(result).toMatchObject({
      ok: false,
      code: "UNSUPPORTED_FOOD_PRICE_COMPARISON",
      cards: [],
      proposals: [],
    });
    expect(result.answerHint).toMatch(/meal prices|food prices|menu prices/i);
  });

  it.each([
    "How much is a pint and food at The Lamb?",
  ])("returns no pint or category figures for an unsupported combination: %s", async (query) => {
    const { result } = await invokePubPalAskTool({
      toolName: "venue_prices",
      args: { query, venueName: "The Lamb" },
      conversationId: null,
    });
    expect(result).toMatchObject({ ok: false, cards: [], proposals: [] });
  });

  it.each([
    "Price of Coke at The Eagle",
    "How much for Coke at The Eagle?",
    "Coke price at The Eagle",
  ])("requests a pub identity instead of a provider-selected pint price: %s", async (query) => {
    const { result } = await invokePubPalAskTool({
      toolName: "venue_prices",
      args: { query, venueName: "The Eagle" },
      conversationId: null,
    });
    expect(result).toMatchObject({
      ok: false,
      tool: "venue_drinks",
      cards: [],
      proposals: [],
    });
    expect(result.answerHint).toMatch(/listed pub/i);
  });

  it("fences the original drive-home request despite a longer clean provider paraphrase", async () => {
    const conversationId = "conv_originalfence01";
    await registerPubPalToolTurn(conversationId, {
      query: "Can I drive home?",
      cityId: "london",
      ownerId: "11111111-1111-4111-8111-111111111111",
    });
    const { result } = await invokePubPalAskTool({
      toolName: "cheapest_pint_near",
      args: { query: "Please help me find the cheapest listed pint near Camden tonight", area: "Camden" },
      conversationId,
    });
    expect(result).toMatchObject({ ok: true, fenced: true, cards: [], proposals: [] });
    expect(result.answerHint).toMatch(/Getting Home/i);
    const turn = await readPubPalToolTurn(conversationId);
    expect(turn?.cards).toEqual([]);
  });

  it.each([
    ["Cheapest vegan curry in Camden", "Please help me find the cheapest listed pint near Camden tonight"],
  ])("guards the unsupported stored query despite a longer provider query: %s", async (query, providerQuery) => {
    const conversationId = "conv_unsupported01";
    await registerPubPalToolTurn(conversationId, {
      query,
      cityId: "london",
      ownerId: "11111111-1111-4111-8111-111111111111",
    });

    const { result } = await invokePubPalAskTool({
      toolName: "cheapest_pint_near",
      args: { query: providerQuery, area: "Camden" },
      conversationId,
    });

    expect(result).toMatchObject({
      ok: false,
      code: "UNSUPPORTED_PRICE_COMPARISON",
      cards: [],
      proposals: [],
    });
    const turn = await readPubPalToolTurn(conversationId);
    expect(turn?.cards).toEqual([]);
    expect(turn?.toolsUsed).toEqual([]);
    expect(turn?.hints).toEqual([result.answerHint]);
  });

  it("keeps the stored named-pub drink subject when a longer provider query asks for pints", async () => {
    const conversationId = "conv_nameddrinks01";
    await registerPubPalToolTurn(conversationId, {
      query: "Cheapest wine at The Lamb",
      cityId: "london",
      ownerId: "11111111-1111-4111-8111-111111111111",
    });

    const { result } = await invokePubPalAskTool({
      toolName: "cheapest_pint_near",
      args: { query: "Please help me find the cheapest listed pint at The Lamb", venueName: "The Lamb" },
      conversationId,
    });

    expect(result.tool).toBe("venue_drinks");
    expect(result.answerHint).not.toMatch(/cheapest listed pints/i);
    const turn = await readPubPalToolTurn(conversationId);
    expect(turn?.toolsUsed).toEqual(["venue_drinks"]);
  });

  it.each([
    ["Meal prices at The Lamb", "How much is a listed pint at The Lamb tonight?"],
  ])("keeps the stored menu question over a provider pint rewrite: %s", async (query, providerQuery) => {
    const conversationId = "conv_pluralguard01";
    await registerPubPalToolTurn(conversationId, {
      query, cityId: "london", ownerId: "11111111-1111-4111-8111-111111111111",
    });
    const { result } = await invokePubPalAskTool({
      toolName: "venue_prices", args: { query: providerQuery, venueName: "The Lamb" }, conversationId,
    });
    expect(result).toMatchObject({ ok: false, tool: "venue_drinks", cards: [], proposals: [] });
    expect((await readPubPalToolTurn(conversationId))?.toolsUsed).toEqual(["venue_drinks"]);
  });

  // The live agent sent these asks and answered that it could not plan a
  // Shoreditch crawl: "tonight" was read as part of the area, and a bare
  // "Shoreditch crawl" planned three pubs across London.
  it.each([
    "Plan me a 3 pub crawl in Shoreditch tonight",
    "Can you plan a Shoreditch crawl?",
  ])("drafts three Shoreditch stops for %j", async (query) => {
    const result = await planFor(query);

    expect(result.ok).toBe(true);
    const draft = result.proposals.find((proposal) => proposal.kind === "draft_plan");
    expect(draft?.stopIds).toHaveLength(3);

    const shoreditch = NIGHT_AREAS.find((area) => area.slug === "shoreditch")!;
    const venues = new Map((await loadConciergeVenues("london")).map((venue) => [venue.id, venue]));
    for (const card of result.cards) {
      const venue = venues.get(card.venueId)!;
      expect(
        haversineKm([shoreditch.centre.lng, shoreditch.centre.lat], [venue.lng, venue.lat]),
      ).toBeLessThan(3);
    }
  });

  it("records a fenced propose_plan in the turn the chat reads", async () => {
    const conversationId = "conv_fencedplan01";
    await registerPubPalToolTurn(conversationId, {
      query: "Plan me a 3 pub crawl in Shoreditch tonight",
      cityId: "london",
      ownerId: "11111111-1111-4111-8111-111111111111",
    });
    fence.forceFenced = true;

    const { result } = await invokePubPalAskTool({
      toolName: "propose_plan",
      args: { query: "Plan me a 3 pub crawl in Shoreditch tonight" },
      conversationId,
    });

    expect(result).toMatchObject({ ok: true, fenced: true, cards: [], proposals: [] });
    const turn = await readPubPalToolTurn(conversationId);
    expect(turn?.toolsUsed).toEqual(["propose_plan"]);
    expect(turn?.hints).toEqual([result.answerHint]);
    // The plan tool runs beside the fence, and a fenced turn keeps none of it.
    expect(turn?.cards).toEqual([]);
    expect(turn?.proposals).toEqual([]);
  });

  it("still returns the get-home register when the store write fails", async () => {
    const conversationId = "conv_fencedplan02";
    await registerPubPalToolTurn(conversationId, {
      query: "Plan me a 3 pub crawl in Shoreditch tonight",
      cityId: "london",
      ownerId: "11111111-1111-4111-8111-111111111111",
    });
    fence.forceFenced = true;
    store.failAppend = true;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { result } = await invokePubPalAskTool({
      toolName: "propose_plan",
      args: { query: "Plan me a 3 pub crawl in Shoreditch tonight" },
      conversationId,
    });

    expect(result).toMatchObject({ ok: true, fenced: true });
    expect(typeof result.answerHint).toBe("string");
    expect(warn).toHaveBeenCalledWith(
      "pub-pal-tool.fenced-append-failed",
      expect.objectContaining({ toolName: "propose_plan" }),
    );
  });
});
