import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { isLimitedMock } = vi.hoisted(() => ({
  isLimitedMock: vi.fn(async () => false),
}));

const { modelLoopMock } = vi.hoisted(() => ({
  modelLoopMock: vi.fn(),
}));

vi.mock("@/lib/serverEnv", () => ({ assertProductionSecrets: () => {} }));

vi.mock("@/lib/ask/modelLoop", () => ({
  runAskModelLoop: modelLoopMock,
}));

vi.mock("@/lib/pintDrops", async () => {
  const actual = await vi.importActual<typeof import("@/lib/pintDrops")>(
    "@/lib/pintDrops",
  );
  return { ...actual, isLimited: isLimitedMock };
});

import { offlineFetch } from "@/evals/pal/offlineFetch";
import { POST } from "@/app/api/ask/route";
import { runAsk } from "@/lib/ask/runAsk";
import { runAskTool } from "@/lib/ask/tools";
import { PAL_WEB_GROUNDING } from "@/lib/palChat";

beforeEach(() => {
  vi.stubGlobal("fetch", offlineFetch);
  isLimitedMock.mockReset().mockResolvedValue(false);
  modelLoopMock.mockReset().mockResolvedValue(null);
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function post(body: unknown, ip: string): Promise<Response> {
  return POST(
    new Request("http://localhost/api/ask", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

describe("POST /api/ask", () => {
  it.each([
    ["propose_plan", "Plan a big night for four of us, with cheap pints and a lively route", { mood: ["lively"], groupSize: 4, maxPintPrice: 6 }],
    ["search_venues", "Find cheap quiet pubs in Soho", { mood: ["quiet"], groupSize: 2, maxPintPrice: 6, area: "Soho" }],
  ] as const)("keeps the original constraints and price evidence at the %s tool boundary", async (tool, query, intent) => {
    const result = await runAskTool(tool, { query: "pubs" }, { cityId: "london", query, skipModel: true });
    expect(result.ok).toBe(true);
    expect(result.tool).toBe(tool);
    expect(result.data).toMatchObject({ intent });
    expect(result.cards.length).toBeGreaterThan(0);
    expect(result.priceEvidence).toHaveLength(result.cards.length);
    for (const card of result.cards) {
      expect(card.price).toBeLessThanOrEqual(6);
      expect(result.priceEvidence).toContainEqual({
        cardKey: card.key, venueId: card.venueId, priceGbp: card.price,
        kind: "listed-pint", category: "beer", source: "directory", reportedAt: null, serving: "pint",
      });
    }
  });

  it.each([
    "How much is wine at The Eagle?",
    "Wine price at The Eagle",
    "What does wine cost at The Eagle?",
    "Wine prices at The Eagle",
    "Prices for wine at The Eagle",
    "Wine costs at The Eagle",
  ])("reads category prices for %s without selecting the pint-price tool", async (query) => {
    const result = await runAsk({ query, cityId: "london", skipModel: true });
    expect(result.toolsUsed).toEqual(["venue_drinks"]);
    expect(result.toolsUsed).not.toContain("venue_prices");
    expect(result.toolsUsed).not.toContain("cheapest_pint_near");
    for (const card of result.cards) {
      expect(card.note).not.toMatch(/recorded pint|listed pint/i);
    }
    expect(modelLoopMock).not.toHaveBeenCalled();
  });

  it("refuses an area burger price before model routing or price cards", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    const result = await runAsk({ query: "How much is a burger in Camden?", cityId: "london" });
    expect(result.answer).toMatch(/meal prices|food prices|menu prices/i);
    expect(result.cards).toEqual([]);
    expect(result.proposals).toEqual([]);
    expect(result.toolsUsed).toEqual([]);
    expect(modelLoopMock).not.toHaveBeenCalled();
  });

  it.each([
    "Price of Coke at The Eagle",
    "How much for Coke at The Eagle?",
    "Coke price at The Eagle",
    "Coke prices at The Eagle",
    "Prices for Coke at The Eagle",
  ])("refuses an unverified Coke price before model routing or pint figures: %s", async (query) => {
    process.env.OPENROUTER_API_KEY = "test-key";
    const result = await runAsk({ query, cityId: "london" });
    expect(result.answer).toMatch(/that item|brand|recorded drinks|listed pint prices/i);
    expect(result.cards).toEqual([]);
    expect(result.proposals).toEqual([]);
    expect(result.toolsUsed).toEqual([]);
    expect(modelLoopMock).not.toHaveBeenCalled();
  });

  it("answers a later explicit pint request after an unsupported meal request", async () => {
    const query = "How much is a burger in Camden?";
    const refused = await runAsk({ query, cityId: "london", skipModel: true });
    const supported = await runAsk({
      query: "Cheapest pint in Camden",
      cityId: "london",
      skipModel: true,
      turns: [{ role: "user", content: query }, { role: "assistant", content: refused.answer }],
    });
    expect(refused.cards).toEqual([]);
    expect(supported.toolsUsed).toEqual(["cheapest_pint_near"]);
    expect(supported.cards.length).toBeGreaterThan(0);
  });

  it.each([
    ["Cheapest vegan food in Camden", /meal prices|dietary/i],
    ["Cheapest wine in Soho", /other drinks across pubs/i],
    ["Cheapest vegan curry in Camden", /can't compare|cannot compare|can compare/i],
    ["Cheapest Coke in Camden", /can't compare|cannot compare|can compare/i],
    ["Cheapest sparkling water in Camden", /can't compare|cannot compare|can compare/i],
    ["Cheapest pub lunch in Camden", /meal prices|dietary/i],
  ])("explains unsupported price coverage for %s without pint cards", async (query, wording) => {
    const result = await runAsk({ query, cityId: "london", skipModel: true });
    expect(result.answer).toMatch(wording);
    expect(result.cards).toEqual([]);
    expect(result.proposals).toEqual([]);
    expect(result.toolsUsed).toEqual([]);
  });

  it("keeps a named-pub wine lookup on recorded drinks before model routing", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    const result = await runAsk({ query: "Cheapest wine at The Lamb", cityId: "london" });
    expect(result.toolsUsed).toEqual(["venue_drinks"]);
    expect(result.answer).not.toMatch(/cheapest listed pints/i);
    expect(modelLoopMock).not.toHaveBeenCalled();
  });

  it("returns the public error envelope when rate limiting fails", async () => {
    isLimitedMock.mockRejectedValueOnce(new Error("limiter unavailable"));

    const response = await post({ query: "Quiet near Bank" }, "198.51.100.19");

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: "Couldn't answer that right now.",
      code: "ASK_UNAVAILABLE",
      retryable: true,
    });
  });

  it("refuses an empty ask", async () => {
    const response = await post({ query: "   " }, "198.51.100.20");
    expect(response.status).toBe(400);
  });

  it("answers a mood ask with grounded venue cards keyless", async () => {
    const response = await post(
      { query: "Garden near Soho for 4, not pricey", cityId: "london" },
      "198.51.100.21",
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(body.status).toBe("ready");
    expect(body.toolsUsed).toContain("search_venues");
    expect(Array.isArray(body.cards)).toBe(true);
    expect(body.cards.length).toBeGreaterThan(0);
    expect(body.cards[0].venueId).toEqual(expect.any(String));
    expect(body.answer).toEqual(expect.any(String));
    expect(body.answer).not.toMatch(/—/);
  });

  it("returns a draft_plan proposal that names its own control without saving a plan", async () => {
    const response = await post(
      { query: "Plan a crawl in Soho for 4", cityId: "london" },
      "198.51.100.22",
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.toolsUsed).toContain("propose_plan");
    const draft = body.proposals.find(
      (p: { kind: string }) => p.kind === "draft_plan",
    );
    expect(draft).toMatchObject({
      kind: "draft_plan",
      query: expect.any(String),
      stopIds: expect.any(Array),
    });
    expect(draft.stopIds.length).toBe(3);
    // Proposal only - the route never mutates durable plan state, and the
    // sentence names the control that exists. Both surfaces open Plan through
    // an "Open in Plan" control, so a bubble saying "Confirm" would name
    // nothing on screen.
    expect(draft.label).toBe("Open in Plan");
    expect(body.answer).toContain("Open in Plan");
    expect(body.answer.toLowerCase()).not.toContain("confirm");
  });

  it("degrades honestly when CityMCP is down", async () => {
    const response = await post(
      { query: "Any tube delays right now?", cityId: "london" },
      "198.51.100.23",
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.toolsUsed).toContain("city_status");
    expect(body.status).toBe("degraded");
    expect(body.answer).toMatch(/unavailable|could not|couldn't/i);
  });

  it("does not let a prior desk ask steal a cheapest-pint follow-up", async () => {
    const result = await runAsk({
      query: "Cheapest pint in Camden",
      cityId: "london",
      skipModel: true,
      turns: [
        { role: "user", content: "Somewhere to work with wifi in Angel" },
        { role: "assistant", content: "No seat data yet." },
      ],
    });
    expect(result.toolsUsed).not.toContain("find_desk");
    expect(result.toolsUsed).toContain("cheapest_pint_near");
  });

  it("accepts in-thread turns for refinement without durable memory writes", async () => {
    const first = await runAsk({
      query: "Quiet near Bank for 4",
      cityId: "london",
      skipModel: true,
    });
    expect(first.cards.length).toBeGreaterThan(0);
    const refined = await runAsk({
      query: "cheaper",
      cityId: "london",
      skipModel: true,
      turns: [
        { role: "user", content: "Quiet near Bank for 4" },
        { role: "assistant", content: first.answer },
      ],
    });
    expect(refined.toolsUsed.length).toBeGreaterThan(0);
    expect(refined.answer).toEqual(expect.any(String));
  });

  it("ignores model answer prose and composes from tool results", async () => {
    const card = {
      key: "venue-1",
      venueId: "venue-1",
      title: "The Lamb",
      place: "Bloomsbury",
      note: "Quiet",
      price: 5.4,
      provenance: { label: "On record", kind: "directory" },
    };
    modelLoopMock.mockResolvedValueOnce({
      toolResults: [{
        ok: true,
        tool: "search_venues",
        data: null,
        provenance: [],
        cards: [card],
        proposals: [],
        answerHint: "The Lamb is listed.",
      }],
      answer: "2 grounded picks from CityMCP",
    });
    process.env.OPENROUTER_API_KEY = "test-key";

    const result = await runAsk({ query: "Somewhere quiet in Bloomsbury", cityId: "london" });

    expect(result.answer).toBe("1 pick from the listed pubs, each with its source. The Lamb is listed.");
    expect(result.answer).not.toMatch(/CityMCP|grounded/iu);
  });
});

describe("Night OS Ask fences", () => {
  it("keeps web grounding off", () => {
    expect(PAL_WEB_GROUNDING).toBe(false);
  });
});
