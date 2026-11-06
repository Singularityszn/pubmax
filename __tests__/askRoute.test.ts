import { VIBE_CHIPS } from "@/lib/vibeChips";
import { GROUP_MAP_REQUESTS, SOCIAL_MAP_COMMANDS, serviceBesideMap } from "./fixtures/askMapCommands";
import { JOURNEY_ENDPOINT_REQUESTS, NAMED_QUALIFIED_PRICE_REQUESTS, NAMED_TERMINAL_PRICE_REQUESTS, QUALIFIED_PRICE_REQUESTS } from "./fixtures/askPriceSubjects";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { isLimitedMock } = vi.hoisted(() => ({
  isLimitedMock: vi.fn(async () => false),
}));

const { modelLoopMock } = vi.hoisted(() => ({
  modelLoopMock: vi.fn(),
}));

vi.mock("@/lib/serverEnv", () => ({ assertProductionSecrets: () => {} }));

vi.mock("@/lib/ask/modelLoop", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ask/modelLoop")>()),
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
import { GET as getVenue } from "@/app/api/venue/[id]/route";
import { runAsk } from "@/lib/ask/runAsk";
import { runAskTool } from "@/lib/ask/tools";
import { resetJourneyCache } from "@/lib/citymcp/client";
import { PAL_WEB_GROUNDING } from "@/lib/palChat";

beforeEach(() => {
  vi.stubGlobal("fetch", offlineFetch);
  isLimitedMock.mockReset().mockResolvedValue(false);
  modelLoopMock.mockReset().mockResolvedValue(null);
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
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
  it.each(["Directions to The Harp from London Bridge", "Directions from London Bridge to The Harp", "How do I get from London Bridge to The Harp?"].flatMap((service) =>
    ["Open the map", "Open the full map", "View the whole map please", "Open the full map for tonight"].flatMap((map) => serviceBesideMap(service, map)),
  ))(
    "separates supported map commands from both journey endpoints: %s", async (query) => {
      resetJourneyCache();
      const journeyFetch = vi.fn<typeof fetch>(async (input, init) => {
        if (JSON.parse(init?.body as string).params.name !== "get_journey") return offlineFetch(input, init);
        return Response.json({ jsonrpc: "2.0", result: { structuredContent: { journeys: [{ durationMinutes: 12, legs: [] }] } } });
      });
      vi.stubGlobal("fetch", journeyFetch);
      const response = await post({ query, cityId: "london" }, "203.0.113.186");
      const body = await response.json();
      expect(response.status).toBe(200);
      expect(body.toolsUsed).toEqual(["journey"]);
      const call = journeyFetch.mock.calls.find(([, init]) => JSON.parse(init?.body as string).params.name === "get_journey");
      expect(JSON.parse(call?.[1]?.body as string).params.arguments).toEqual({ from: "51.50500,-0.08600", to: "51.50960,-0.12606" });
      expect(body.cards).toContainEqual(expect.objectContaining({ venueId: "venue-1bz7oic", place: "The Harp" }));
    },
  );

  it.each(["Show the map please", "Show me the full map", "View the whole map please"].flatMap((map) => serviceBesideMap("Cheapest pint near Soho", map)))(
    "separates supported map commands from pint comparisons: %s", async (query) => {
      const response = await post({ query, cityId: "london" }, "203.0.113.186");
      const body = await response.json();
      expect(response.status).toBe(200);
      expect(body.toolsUsed).toEqual(["cheapest_pint_near"]);
      expect(body.answer).not.toContain("not prices for that item");
    },
  );

  it.each([
    "OK. Show me the map",
    "Alright, show me the map",
    "Great. Show the map",
    "That sounds good. Show me the map",
    "In fact, show me the map",
    ...SOCIAL_MAP_COMMANDS,
  ].flatMap((query) => [false, true].map((withHistory) => ({ query, withHistory }))))(
    "keeps acknowledgement map actions through HTTP ($withHistory): $query", async ({ query, withHistory }) => {
      const evidence = "Show the source and date for any price you use";
      const turns = withHistory ? [{ role: "user", content: "Find four pubs in Camden" }] : [];
      for (const request of [query, evidence + ". " + query, query + " and " + evidence]) {
        const response = await post({ query: request, turns, cityId: "london" }, "203.0.113.189");
        const body = await response.json();
        expect(response.status).toBe(200);
        expect(body.toolsUsed).toEqual(["propose_map_action"]);
        expect(body.cards).toEqual([]);
        expect(body.proposals).toEqual([]);
      }
    },
  );

  it.each(["Show me the map", "Show the map", "Show The Lamb on the map", "Show The Harp", "Hi. Show me the map", "Show the map. Thanks", "Could you please show me the map", "Thank you and show the map"])("routes genuine map commands beside evidence through HTTP: %s", async (request) => {
    const evidence = "Show the source and date for any price you use";
    for (const query of [request, `${evidence}. ${request}`, `${request} and ${evidence}`, `${evidence}. ${request} and ${evidence}`]) {
      const response = await post({ query, cityId: "london" }, "203.0.113.188");
      const body = await response.json();
      expect(response.status).toBe(200);
      expect(body.toolsUsed).toEqual(["propose_map_action"]);
      if (request === "Show The Harp") {
        expect(body.proposals).toMatchObject([{ kind: "open_venue" }, { kind: "fly_to", place: "The Harp", venueId: "venue-1bz7oic" }]);
      }
    }
  });

  it.each(["any tube delays?", "How much is a pint at The Lamb?"])("keeps journey endpoints and the second HTTP request around evidence: %s", async (other) => {
    const journey = "Directions to The Lamb from London Bridge";
    const evidence = "show the source and date for any price you use";
    for (const [left, right] of [[journey, other], [other, journey]]) {
      resetJourneyCache();
      const journeyFetch = vi.fn<typeof fetch>(async (input, init) => {
        if (JSON.parse(init?.body as string).params.name !== "get_journey") return offlineFetch(input, init);
        return Response.json({ jsonrpc: "2.0", result: { structuredContent: { journeys: [{ durationMinutes: 12, legs: [] }] } } });
      });
      vi.stubGlobal("fetch", journeyFetch);
      const query = `${left} and ${evidence} and ${right}`;
      const response = await post({ query, cityId: "london" }, "203.0.113.188");
      const body = await response.json();
      expect(response.status).toBe(200);
      expect(body.toolsUsed).toEqual(other.includes("tube") ? ["city_status", "journey"] : ["journey", "venue_prices"]);
      const call = journeyFetch.mock.calls.find(([, init]) => JSON.parse(init?.body as string).params.name === "get_journey");
      expect(JSON.parse(call?.[1]?.body as string).params.arguments).toEqual({ from: "51.50500,-0.08600", to: "The Lamb" });
      if (!other.includes("tube")) expect(body.cards.some((card: { place: string }) => card.place === "The Lamb")).toBe(true);
    }
  });

  it.each(["cheap", "somewhere cheap", "cheap and quiet"])("keeps supported cheap follow-up cards in the inherited area: %s", async (request) => {
    const send = (body: unknown) => post(body, "203.0.113.187");
    const baseline = await send({ query: `${request} in Camden`, cityId: "london" });
    const expected = await baseline.json();
    expect(baseline.status).toBe(200);
    expect(expected.toolsUsed).toEqual(["search_venues"]);
    expect(expected.cards.length).toBeGreaterThan(0);
    const evidence = "Show the source and date for any price you use";
    for (const query of [request, `${request} and ${evidence}`, `${evidence}. ${request}`, `${evidence}. ${request} and ${evidence}. Include the map`]) {
      const response = await send({ query, cityId: "london", turns: [{ role: "user", content: "pubs in Camden" }] });
      const body = await response.json();
      expect(response.status).toBe(200);
      expect(body.toolsUsed).toEqual(["search_venues"]);
      expect(body.cards.map((card: { venueId: string }) => card.venueId)).toEqual(expected.cards.map((card: { venueId: string }) => card.venueId));
      expect(body.cards.every((card: { place: string }) => /Camden/i.test(card.place))).toBe(true);
      expect(body.answer).not.toContain("not prices for that item");
    }
  });

  it.each([
    ["cheap burgers", /meal prices|dietary/i],
    ["cheap wine", /other drinks across pubs/i],
    ["quiet and cheap", /not prices for that item/i],
  ])("keeps existing price refusals after an evidence-bearing follow-up: %s", async (request, wording) => {
    const send = (body: unknown) => post(body, "203.0.113.187");
    const evidence = "Show the source and date for any price you use";
    for (const query of [`${request} and ${evidence}`, `${evidence}. ${request} and ${evidence}`]) {
      const response = await send({ query, cityId: "london", turns: [{ role: "user", content: "pubs in Camden" }] });
      const body = await response.json();
      expect(response.status).toBe(200);
      expect(body.toolsUsed).toEqual([]);
      expect(body.cards).toEqual([]);
      expect(body.answer).toMatch(wording);
    }
  });

  it.each([
    ["Find pubs in Camden", "somewhere quiet and please include sources and dates for every price you quote"],
    ["Find pubs in Camden and show the source and date for any price you use", "somewhere quiet"],
    ["Find pubs and show the source and date for any price you use", "somewhere quiet"],
  ])("keeps discovery cards after an evidence-bearing follow-up: %s / %s", async (prior, query) => {
    const response = await post({ query, cityId: "london", turns: [{ role: "user", content: prior }] }, "203.0.113.186");
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.toolsUsed).toEqual(["search_venues"]);
    expect(body.cards.length).toBeGreaterThan(0);
    if (prior.includes("Camden")) {
      expect(body.cards.every((card: { place: string }) => /Camden/i.test(card.place))).toBe(true);
    }
    expect(body.answer).not.toContain("not prices for that item");
  });

  it("keeps mood-only discovery beside evidence and map instructions", async () => {
    const request = "Quiet-ish near Bank, 4 of us.";
    const queries = [request, `Show the source and date for any price you use. ${request}`, `${request} Show the map.`, `${request} Show sources for any price you use and include the date. Include the map.`];
    const choices: string[][] = [];
    for (const query of queries) {
      const response = await post({ query, cityId: "london" }, "203.0.113.185");
      const body = await response.json();
      expect(response.status).toBe(200);
      expect(body.toolsUsed).toEqual(["search_venues"]);
      expect(body.cards.length).toBeGreaterThan(0);
      expect(body.cards.every((card: { note: string }) => !/date-night/i.test(card.note))).toBe(true);
      choices.push(body.cards.map((card: { venueId: string }) => card.venueId));
    }
    for (const ids of choices.slice(1)) expect(ids).toEqual(choices[0]);
  });

  it.each([
    "Find three quiet pubs in Soho for tonight. Show the source and date for any price you use.",
    "Show the source and date for any price you use. Find three quiet pubs in Soho for tonight.",
    "Show the source and date for any price you use. Recommend three quiet pubs in Soho.",
    "Show the source and date for any price you use. Suggest three quiet pubs in Soho.",
    "Find three quiet pubs in Soho. Show sources for any price you use and show the date for every price you quote.",
    "Show sources for any price you use and please show the date for every price you quote. Recommend three quiet pubs in Soho.",
    "Find three quiet pubs in Soho and please include sources and dates for every price you quote",
  ])("keeps pub discovery when the request asks for price evidence: %s", async (query) => {
    const response = await post({ query, cityId: "london" }, "203.0.113.184");
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.toolsUsed).toEqual(["search_venues"]);
    expect(body.cards).toHaveLength(3);
    expect(body.answer).not.toContain("not prices for that item");
    expect(body.cards.every((card: { note: string }) => !/date-night/i.test(card.note))).toBe(true);
  });

  it.each(GROUP_MAP_REQUESTS)("keeps the map-tail group through discovery and Plan: %s", async (query) => {
    for (const tool of ["search_venues", "propose_plan"] as const) {
      const result = await runAskTool(tool, { query, limit: 3 }, { query, cityId: "london", skipModel: true });
      expect(result.ok).toBe(true);
      expect(result.data).toMatchObject({ intent: { groupSize: 8, area: "Soho" } });
      if (tool === "propose_plan") {
        expect(result.proposals).toContainEqual(expect.objectContaining({ kind: "draft_plan", query }));
      }
    }
  });

  it.each([
    ["search_venues", "Find three quiet pubs in Soho for tonight. Show the source and date for any price you use.", 2, undefined],
    ["search_venues", "Find three quiet pubs in Soho for four people under £7 a pint and please include sources and dates for every price you quote", 4, 7],
    ["propose_plan", "Show the source and date for any price you use. Plan a quiet crawl in Soho for four people under £7 a pint.", 4, 7],
    ["propose_plan", "Show the source and date for any price you use. Sort me a quiet night in Soho for four people under £7 a pint.", 4, 7],
    ["propose_plan", "Show sources for any price you use and show the date for every price you quote. Sort me a quiet night in Soho for four people under £7 a pint.", 4, 7],
    ["search_venues", "Find three quiet pubs in Soho for four people under £7 a pint. Show sources for any price you use and show the date for every price you quote.", 4, 7],
  ] as const)("keeps ranking preferences and the complete %s request", async (tool, query, groupSize, maxPintPrice) => {
    const result = await runAskTool(tool, { query, limit: 3 }, { query, cityId: "london", skipModel: true });
    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({ intent: { mood: ["quiet"], area: "Soho", groupSize } });
    expect((result.data as { intent: { maxPintPrice?: number } }).intent.maxPintPrice).toBe(maxPintPrice);
    expect(result.cards).toHaveLength(3);
    expect(result.cards.every((card) => !/date-night/i.test(card.note ?? ""))).toBe(true);
    if (tool === "propose_plan") {
      expect(result.proposals).toContainEqual(expect.objectContaining({ kind: "draft_plan", query }));
    }
  });

  it("carries each Soho pint publisher and read date into its answer card", async () => {
    const response = await post({ query: "Find me four pubs in Soho", cityId: "london" }, "203.0.113.183");
    const body = await response.json();
    expect(response.status).toBe(200);
    const card = body.cards.find((item: { venueId: string }) => item.venueId === "venue-e1srzr");
    expect(card).toMatchObject({ price: 6.25, provenance: { kind: "directory", label: "Pint Prices. Source read 2 October 2026." } });
  });

  it("asks for a listed pub instead of arbitrary cards for an unanchored pint comparison", async () => {
    const query = "Cheapest pint";
    const body = await (await post({ query, cityId: "london" }, "203.0.113.82")).json();
    expect(body.toolsUsed).toEqual(["venue_prices"]);
    expect(body.answer).toBe("Name a listed pub to check a price.");
    expect(body.cards).toEqual([]);
    const result = await runAskTool("search_venues", { query }, { query, cityId: "london", skipModel: true });
    expect(result.cards).toEqual([]);
  });

  it.each(["Is the Tube running tonight?", "Are there Tube delays?"])("answers a public transit interrogative: %s", async (query) => {
    const response = await post({ query, cityId: "london" }, "203.0.113.82");
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.toolsUsed).toEqual(["city_status"]);
    expect(body.answer).toMatch(/transit|city status|tube|weather/i);
    expect(body.cards).toEqual([]);
  });

  it.each([
    "Is the Tube running tonight and wine prices at Fox and Anchor?",
    "Wine prices at Fox and Anchor and are there Tube delays?",
  ])("preserves category authority beside a public transit interrogative: %s", async (query) => {
    const body = await (await post({ query, cityId: "london" }, "203.0.113.82")).json();
    expect(body.toolsUsed).toEqual(["city_status", "venue_drinks"]);
    expect(body.answer).toContain("Fox and Anchor");
    expect(body.answer).not.toMatch(/can't verify|can't compare|not prices for that item/i);
    const result = await runAskTool("venue_prices", { venueName: "The Lamb" }, { query, cityId: "london", skipModel: true });
    expect(result).toMatchObject({ tool: "venue_drinks", data: { venueId: "venue-phg4ss" } });
    expect(result.priceEvidence?.filter((price) => price.category !== "wine")).toEqual([]);
  });

  it("scopes missing Sherlock Holmes wine prices to people logs while preserving its published menu", async () => {
    const body = await (await post({ query: "Wine prices at Sherlock Holmes", cityId: "london" }, "203.0.113.82")).json();
    expect(body.toolsUsed).toEqual(["venue_drinks"]);
    expect(body.cards).toHaveLength(8);
    expect(body.cards[0]).toMatchObject({ venueId: "venue-gk2fp9", price: 7.2, menuEvidence: { itemName: "Organic Pinot Grigio, Riff, Italy", serving: null, caloriesKcal: null, observedAt: "2026-09-21T18:41:07.759Z" } });
    expect(body.cards.every((card: { menuEvidence: { category: string } }) => card.menuEvidence.category === "wine")).toBe(true);
    expect(body.proposals).toMatchObject([{ kind: "open_venue", venueId: expect.any(String) }]);
    const id = body.proposals[0].venueId;
    const detail = await (await getVenue(new Request(`http://localhost/api/venue/${id}`), {
      params: Promise.resolve({ id }),
    })).json();
    expect(detail.venue.priceUpdates.drink).toContainEqual(expect.objectContaining({
      drinkName: "Organic Pinot Grigio, Riff, Italy",
      category: "wine",
      priceGbp: 7.2,
      observedAt: "2026-09-21T18:41:07.759Z",
      source: expect.objectContaining({ url: "https://www.greeneking.co.uk/pubs/greater-london/sherlock-holmes/menu" }),
    }));
    expect(body.answer).toContain("No people-logged wine prices recorded at Sherlock Holmes yet.");
    expect(body.answer).toContain("Organic Pinot Grigio, Riff, Italy at Sherlock Holmes: £7.20.");
    expect(body.sources).toContainEqual(expect.objectContaining({ kind: "published-menu", url: "https://www.greeneking.co.uk/pubs/greater-london/sherlock-holmes/menu" }));
  });

  it.each(NAMED_QUALIFIED_PRICE_REQUESTS)("keeps named prices across time qualifiers: $query", async ({ query, tool, category }) => {
    const body = await (await post({ query, cityId: "london" }, "203.0.113.82")).json();
    expect(body.toolsUsed).toEqual([tool]);
    expect(body.answer).toContain("Fox and Anchor");
    expect(body.answer).not.toMatch(/can't verify|can't compare|not prices for that item/i);
    const result = await runAskTool("venue_prices", { venueName: "The Lamb", query: "pints" }, { query, cityId: "london", skipModel: true });
    expect(result).toMatchObject({ tool, data: { venueId: "venue-phg4ss" } });
    if (category) expect(result.priceEvidence?.filter((price) => price.category !== category)).toEqual([]);
  });

  it.each(JOURNEY_ENDPOINT_REQUESTS)("preserves both public journey endpoints: $query", async ({ query, from, to, venueId, name }) => {
    resetJourneyCache();
    const journeyFetch = vi.fn<typeof fetch>(async (input, init) => {
      if (JSON.parse(init?.body as string).params.name !== "get_journey") return offlineFetch(input, init);
      return Response.json({ jsonrpc: "2.0", result: { structuredContent: { journeys: [{ durationMinutes: 12, legs: [] }] } } });
    });
    vi.stubGlobal("fetch", journeyFetch);
    const body = await (await post({ query, cityId: "london" }, "203.0.113.82")).json();
    expect(body.toolsUsed).toEqual(query.includes("tube delays") ? ["city_status", "journey"] : ["journey"]);
    expect(body.cards).toMatchObject([{ venueId, place: name }]);
    const request = journeyFetch.mock.calls.find(([, init]) => JSON.parse(init?.body as string).params.name === "get_journey");
    expect(JSON.parse(request?.[1]?.body as string).params.arguments).toEqual({ from, to });
  });

  it.each(NAMED_TERMINAL_PRICE_REQUESTS)("retains the named pint price through terminal grammar: %s", async (query) => {
    const body = await (await post({ query, cityId: "london" }, "203.0.113.82")).json();
    expect(body.toolsUsed).toEqual(["venue_prices"]);
    expect(body.answer).toContain("The Blackfriar");
    expect(body.cards.every((card: { venueId: string }) => card.venueId === "venue-eltcmh")).toBe(true);
    const result = await runAskTool("cheapest_pint_near", { venueName: "The Lamb", query: "pints" }, { query, cityId: "london", skipModel: true });
    expect(result).toMatchObject({ tool: "venue_prices", data: { venueId: "venue-eltcmh" } });
    expect(result.priceEvidence?.length).toBeGreaterThan(0);
  });

  it.each(["Any tube delays and how much is a burger in Camden?", "How much is wine in Soho and any tube delays?", "How much is Coke in Soho and directions to Bank?"])("review regression: retains independent transit while refusing prices: %s", async (query) => {
    const response = await post({ query, cityId: "london" }, "203.0.113.82");
    const body = await response.json();
    expect(body.answer).toMatch(/not prices for that item|meal prices|other drinks across pubs/i);
    expect(body.answer).toMatch(/journey|transit|city status|tube|weather/i);
    expect(body.toolsUsed).toEqual([query.includes("directions") ? "journey" : "city_status"]);
    expect(body.cards).toEqual([]);
    expect(body.proposals).toEqual([]);
    const result = await runAskTool(body.toolsUsed[0], {}, { cityId: "london", query, skipModel: true });
    expect(result.answerHint).not.toMatch(/meal prices|other drinks across pubs|not prices for that item/i);
    expect(result.data).not.toMatchObject({ kind: "unsupported-price" });
  });

  it.each(["Any tube delays and how much is wine at The Lamb?", "How much is wine at The Lamb and any tube delays?"])("retains recorded categories and independent status in both clause orders: %s", async (query) => {
    const result = await runAsk({ query, cityId: "london", skipModel: true });
    expect(result.toolsUsed).toEqual(["city_status", "venue_drinks"]);
    expect(result.answer).not.toMatch(/other drinks across pubs|cheapest listed pints/i);
    const recorded = await runAskTool("venue_prices", { venueName: "Soho", query: "pints" }, { cityId: "london", query, skipModel: true });
    expect(recorded.tool).toBe("venue_drinks");
    expect(recorded.priceEvidence?.every((price) => price.category === "wine")).toBe(true);
  });

  it.each([
    ["Fox and Anchor", "venue-phg4ss", "51.52042,-0.10071"],
    ["Fox and Firkin", "venue-xoqiq5", "51.45690,-0.01438"],
    ["Fox & Anchor", "venue-phg4ss", "51.52042,-0.10071"],
    ["The Black Friar, Blackfriars", "venue-eltcmh", "51.51210,-0.10368"],
    ["Elephant and Castle station", "", "Elephant and Castle station"],
    ["Fox and Unknown", "", "Fox and Unknown"],
    ["Fox and Anchor and any tube delays?", "venue-phg4ss", "51.52042,-0.10071"],
  ])("keeps the complete public journey destination: %s", async (destination, venueId, to) => {
    resetJourneyCache();
    const journeyFetch = vi.fn<typeof fetch>(async (input, init) => {
      if (JSON.parse(init?.body as string).params.name !== "get_journey") return offlineFetch(input, init);
      return new Response(JSON.stringify({
        jsonrpc: "2.0", result: { structuredContent: { journeys: [{ durationMinutes: 12, legs: [] }] } },
      }), { headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", journeyFetch);
    const response = await post({ query: `Directions to ${destination}`, cityId: "london" }, "203.0.113.82");
    const body = await response.json();
    expect(body.toolsUsed).toEqual(destination.includes("tube delays") ? ["city_status", "journey"] : ["journey"]);
    expect(body.cards).toMatchObject([{ venueId, place: venueId === "venue-phg4ss" ? "Fox and Anchor" : venueId === "venue-eltcmh" ? "The Blackfriar" : destination }]);
    const journeyRequest = journeyFetch.mock.calls.find(([, init]) => JSON.parse(init?.body as string).params.name === "get_journey");
    expect(journeyRequest).toBeDefined();
    const payload = JSON.parse(journeyRequest?.[1]?.body as string);
    expect(payload.params.arguments).toMatchObject({ from: "51.50500,-0.08600", to });
  });

  it("resolves complete compound names on both journey axes", async () => {
    resetJourneyCache();
    const journeyFetch = vi.fn<typeof fetch>(offlineFetch);
    const result = await runAskTool("journey", { from: "Fox & Anchor", to: "Fox" }, {
      query: "Directions to Fox and Firkin", cityId: "london", skipModel: true, fetchImpl: journeyFetch,
    });
    expect(result.ok).toBe(true);
    expect(result.proposals).toMatchObject([{ venueId: "venue-xoqiq5" }]);
    expect(JSON.parse(journeyFetch.mock.calls[0]?.[1]?.body as string).params.arguments).toEqual({
      from: "51.52042,-0.10071", to: "51.45690,-0.01438",
    });
  });

  it.each([
    ["Fox and Anchor", "venue-phg4ss", "Fox and Anchor"],
    ["Fox and Firkin", "venue-xoqiq5", "Fox and Firkin"],
    ["Fox & Anchor", "venue-phg4ss", "Fox and Anchor"],
    ["Fox and Anchor near the Tube", "venue-phg4ss", "Fox and Anchor"],
    ["The Black Friar, Blackfriars", "venue-eltcmh", "The Blackfriar"],
  ])("keeps compound names and aliases in named category prices: %s", async (name, venueId, canonical) => {
    const query = `Wine prices at ${name}`;
    const response = await post({ query, cityId: "london" }, "203.0.113.82");
    const body = await response.json();
    expect(body.toolsUsed).toEqual(["venue_drinks"]);
    expect(body.answer).toContain(canonical);
    expect(body.cards.every((card: { note: string }) => !/listed pint/i.test(card.note))).toBe(true);
    const result = await runAskTool("venue_prices", { query: "pints", venueName: "The Lamb" }, { cityId: "london", query, skipModel: true });
    expect(result.data).toMatchObject({ venueId });
    expect(result.priceEvidence?.every((price) => price.category === "wine")).toBe(true);
  });

  it.each(VIBE_CHIPS)("retains the actual $label constraints at tool execution", async (chip) => {
    const tool = { bender: "propose_plan", lit: "whats_on", quiet: "search_venues", cheeky: "search_venues", match: "whats_on", quiz: "whats_on", date: "search_venues" }[chip.id];
    const result = await runAskTool(tool, { query: chip.ask }, { query: chip.ask, cityId: "london", skipModel: true });
    expect(result.ok).toBe(true);
    if (["lit", "match", "quiz"].includes(chip.id)) {
      const kind = { lit: "music", match: "sport", quiz: "quiz" }[chip.id as "lit" | "match" | "quiz"];
      expect(result.data).toMatchObject({ kind, window: "tonight" });
      expect(result.answerHint).toMatch(/sourced.*tonight/i);
      expect(result.cards.every((card) => card.provenance?.kind === "whats-on")).toBe(true);
    } else {
      expect(result.data).toMatchObject({ intent: { mood: expect.arrayContaining([...chip.moods]) } });
      expect(result.cards.length).toBeGreaterThan(0);
      expect(result.priceEvidence).toHaveLength(result.cards.length);
      if (chip.id === "cheeky" || chip.id === "bender") {
        expect(result.data).toMatchObject({ intent: { maxPintPrice: 6 } });
        expect(result.cards.every((card) => typeof card.price === "number" && card.price <= 6)).toBe(true);
      }
      if (chip.id === "bender") expect(result.data).toMatchObject({ intent: { groupSize: 4 } });
      if (chip.id === "date") {
        const venues = (result.data as { venues: Array<{ reasons: string[] }> }).venues;
        expect(venues.every((venue) => venue.reasons.includes("Good date-night fit") && venue.reasons.includes("Venue heritage on record") && venue.reasons.includes("A calmer fit"))).toBe(true);
      }

    }
  });

  it.each(["search_venues", "venue_prices", "venue_drinks", "cheapest_pint_near", "venue_heritage"])("preserves original discovery intent when the provider chooses %s", async (tool) => {
    for (const id of ["quiet", "cheeky", "date"]) {
      const chip = VIBE_CHIPS.find((chip) => chip.id === id)!;
      const result = await runAskTool(tool, { venueName: "The Lamb", query: "The Lamb" }, { query: chip.ask, cityId: "london", skipModel: true });
      expect(result).toMatchObject({ ok: true, tool: "search_venues", data: { intent: { mood: expect.arrayContaining([...chip.moods]) } } });
      expect(result.cards.length).toBeGreaterThan(0);
      expect(result.priceEvidence).toHaveLength(result.cards.length);
    }
  });

  it.each(QUALIFIED_PRICE_REQUESTS)("fences the complete price request at HTTP and tool boundaries: $query", async ({ query, code, wording }) => {
    const response = await post({ query, cityId: "london" }, "203.0.113.82");
    const body = await response.json();
    expect(body.answer).toMatch(wording);
    expect(body.cards).toEqual([]);
    expect(body.toolsUsed).toEqual([]);
    const keyless = await runAsk({ query, cityId: "london", skipModel: true });
    expect(keyless.answer).toMatch(wording);
    expect(keyless.cards).toEqual([]);
    for (const name of ["search_venues", "venue_prices", "venue_drinks", "cheapest_pint_near"] as const) {
      const result = await runAskTool(name, { query: "pints", venueName: "The Lamb" }, { cityId: "london", query, skipModel: true });
      expect(result).toMatchObject({ ok: false, data: { code }, cards: [], proposals: [], priceEvidence: [] });
    }
  });

  it.each([
    ["Any tube delays and how much is a pint at The Lamb?", "venue_prices"],
    ["Any tube delays and how much is wine at The Lamb?", "venue_drinks"],
    ["Any tube delays and cheapest drinks in Soho", "search_venues"],
  ])("review regression: preserves transit and price results in one public request: %s", async (query, priceTool) => {
    const result = await runAsk({ query, cityId: "london", skipModel: true });
    expect(result.toolsUsed).toEqual(["city_status", priceTool]);
    expect(result.answer).toContain("City status is unavailable just now.");
    if (priceTool !== "venue_drinks") expect(result.cards.some((card) => typeof card.price === "number")).toBe(true);
  });

  it.each([
    "Any tube delays and how much is a pint at The Lamb?",
    "Any tube delays and how much is wine at The Lamb?",
    "Find cheap drinks in Soho",
  ])("review regression: preserves independent tools at the shared boundary: %s", async (query) => {
    for (const tool of ["city_status", "journey", "whats_on", "venue_heritage", "area_buzz", "propose_plan", "propose_map_action", "tonight_now", "find_desk", "report_occupancy"] as const) {
      const result = await runAskTool(tool, {}, { cityId: "london", query, skipModel: true });
      expect(result.tool).toBe(tool);
    }
  });

  it.each([
    ["propose_plan", "Plan a big night for four of us, with cheap pints and a lively route", { mood: ["lively"], groupSize: 4, maxPintPrice: 6 }],
    ["search_venues", "Find cheap quiet pubs in Soho", { mood: ["quiet"], groupSize: 2, maxPintPrice: 6, area: "Soho" }],
    ["search_venues", "somewhere cheap and quiet", { mood: ["quiet"], groupSize: 2, maxPintPrice: 6 }],
    ["search_venues", "Somewhere cheap in Soho", { mood: [], groupSize: 2, maxPintPrice: 6, area: "Soho" }],
    ["search_venues", "Find four pubs in Soho under £6 a pint.", { mood: [], groupSize: 2, maxPintPrice: 6, area: "Soho" }],
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
  ])("requests a pub identity for ambiguous named Coke pricing: %s", async (query) => {
    process.env.OPENROUTER_API_KEY = "test-key";
    const result = await runAsk({ query, cityId: "london" });
    expect(result.answer).toMatch(/listed pub/i);
    expect(result.cards).toEqual([]);
    expect(result.proposals).toEqual([]);
    expect(result.toolsUsed).toEqual(["venue_drinks"]);
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

  it("runs the model loop on a Claude key alone, with no OpenRouter key", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";

    await runAsk({ query: "Somewhere quiet in Bloomsbury", cityId: "london" });

    expect(modelLoopMock).toHaveBeenCalledTimes(1);
  });

  it("keeps the model loop off with neither key", async () => {
    await runAsk({ query: "Somewhere quiet in Bloomsbury", cityId: "london" });

    expect(modelLoopMock).not.toHaveBeenCalled();
  });
});

describe("Night OS Ask fences", () => {
  it("keeps web grounding off", () => {
    expect(PAL_WEB_GROUNDING).toBe(false);
  });
});
