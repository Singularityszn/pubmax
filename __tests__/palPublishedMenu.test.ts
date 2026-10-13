import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { offlineFetch } from "@/evals/pal/offlineFetch";

vi.mock("@/lib/pintDrops", () => ({ isLimited: async () => false }));
vi.mock("@/lib/supabase", () => ({
  clientIp: () => "203.0.113.44", hashIp: (ip: string) => ip,
  isSupabaseConfigured: () => false, requiresSupabaseStore: () => false,
}));

import { POST as ask } from "@/app/api/ask/route";
import { POST as chat } from "@/app/api/pub-pal/chat/route";
import { POST as webhook } from "@/app/api/pub-pal/tools/[toolName]/route";
import { GET as venue } from "@/app/api/venue/[id]/route";
import { runPalElevenLabsChatTurn } from "@/lib/palElevenLabsChat.server";
import { registerPubPalToolTurn, readOwnedPubPalToolTurn, __resetPubPalToolTurnStore } from "@/lib/pubPalToolTurnStore";
import { routeAskDeterministically, resolveAskPriceIntent } from "@/lib/ask/router";
import { NAMED_MENU_PRICE_REQUESTS, JOURNEY_ENDPOINT_REQUESTS } from "./fixtures/askPriceSubjects";
import { runAskTool } from "@/lib/ask/tools";
import { createPalChatSession } from "@/lib/palChatClient";
import { resetJourneyCache } from "@/lib/citymcp/client";
import * as priceUpdates from "@/lib/priceUpdates.server";
import { parseFoodPriceUpdates } from "@/lib/foodPriceUpdates";

function request(query: string) {
  return new Request("http://localhost/api/ask", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, cityId: "london" }),
  });
}

beforeEach(() => {
  vi.stubEnv("ELEVENLABS_API_KEY", "");
  vi.stubEnv("OPENROUTER_API_KEY", "");
  vi.stubEnv("TYPESAFE_API_KEY", "");
  vi.stubGlobal("fetch", offlineFetch);
  __resetPubPalToolTurnStore();
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

it.each([ask, chat])("returns accepted New Inn facts through a public POST", async (post) => {
  const detail = await venue(new Request("http://localhost/api/venue/venue-17qpap6"), { params: Promise.resolve({ id: "venue-17qpap6" }) });
  const { venue: pub } = await detail.json();
  expect(pub.address).toBe("62 St Mary's Rd, London W5 5EX, UK");
  expect(pub.priceUpdates.food).toContainEqual(expect.objectContaining({ itemName: "Mixed Olives", priceGbp: 5, caloriesKcal: 163, dietary: ["vegan", "vegetarian"] }));
  const response = await post(request("What are the price and published calories for Mixed Olives at The New Inn?"));
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.cards).toContainEqual(expect.objectContaining({ venueId: "venue-17qpap6", price: 5,
    menuEvidence: expect.objectContaining({ itemName: "Mixed Olives", currency: "GBP", serving: null, caloriesKcal: 163, dietary: ["vegan", "vegetarian"], availability: "unknown" }),
  }));
  expect(body.answer).toContain("163 kcal");
  expect(body.sources).toContainEqual(expect.objectContaining({ url: "https://www.newinnealing.com/food-and-drink" }));
});

it("preserves published Sherlock Holmes wine without claiming a serving", async () => {
  const body = await (await ask(request("Wine prices at Sherlock Holmes"))).json();
  expect(body.cards).toContainEqual(expect.objectContaining({ price: 7.2, menuEvidence: expect.objectContaining({ itemName: "Organic Pinot Grigio, Riff, Italy", serving: null, caloriesKcal: null, observedAt: "2026-09-21T18:41:07.759Z" }) }));
});

it.each([0, undefined])("retains a fixture's %s calories through the public menu boundary", async (caloriesKcal) => {
  const food = parseFoodPriceUpdates([{
    venueKey: "the new inn|62 st mary's rd, london w5 5ex, uk|51.50500|-0.30568",
    itemName: "Energy fixture", category: "other", priceGbp: 1,
    ...(caloriesKcal === undefined ? {} : { caloriesKcal }),
    source: { label: "Explicit test fixture", licence: "Test only", url: "https://example.com/fixture" },
    observedAt: "2026-10-13T09:43:11.443Z",
  }]);
  expect(food).toHaveLength(1);
  vi.spyOn(priceUpdates, "venuePriceUpdatesFor").mockResolvedValue({ food, drink: [] });
  const body = await (await ask(request("Energy fixture price and calories at The New Inn"))).json();
  expect(body.cards).toHaveLength(1);
  expect(body.cards[0].menuEvidence.caloriesKcal).toBe(caloriesKcal ?? null);
  expect(body.answer).toContain(caloriesKcal === 0 ? "0 kcal" : "Published calories not recorded");
});

it("keeps configured menu answers behind the existing sign-in gate", async () => {
  vi.stubEnv("ELEVENLABS_API_KEY", "offline-test-key");
  vi.stubEnv("ELEVENLABS_PUB_PAL_AGENT_ID", "offline-agent");
  expect((await chat(request("Mixed Olives price at The New Inn"))).status).toBe(401);
});

it.each([
  ["125ml", 7.1, "drink-item-361ac12fe713bf8f"],
  ["750ml", 35.5, "drink-item-4429db194d9cae79"],
])("reads the Eagle's exact %s serving and item identity", async (serving, price, itemId) => {
  const body = await (await ask(request(`Price of ${serving} Steinbock Riesling at The Eagle, Hammersmith and Fulham`))).json();
  expect(body.cards).toHaveLength(1);
  expect(body.cards[0]).toMatchObject({ venueId: "venue-1hz0avt", price,
    menuEvidence: { serving, itemId, itemName: "Steinbock, Riesling, Germany", category: "alcohol-free", caloriesKcal: null, dietary: [], observedAt: "2026-10-13T10:19:25.911Z" },
  });
  expect(body.cards[0].menuEvidence).not.toHaveProperty("abv");
});

it("keeps the Eagle's unknown serving unknown", async () => {
  const body = await (await chat(request("Price of Apple and Elderflower at The Eagle, Hammersmith and Fulham"))).json();
  expect(body.cards).toHaveLength(1);
  expect(body.cards[0]).toMatchObject({ venueId: "venue-1hz0avt", price: 5.35, menuEvidence: { serving: null, caloriesKcal: null, availability: "unknown" } });
});

it.each([
  "Price of Coke at The Eagle", "Meal prices at The Lamb",
  "Price of a double gin at The Lamb", "How much is a gin and tonic at The Lamb?",
  "How much for Coke at The Eagle?", "Coke price at The Eagle", "Coke prices at The Eagle",
  "How much is a cocktail and a pint at The Lamb?", "Price of a 175ml wine at The Lamb",
  "Price of a 175ml wine at The Lamb this evening?", "Price of Coke now at The Lamb?",
  "Price of Coke at The Lamb", "Prices of meals at The Lamb", "Coke prices at The Lamb",
])("does not substitute a pint for an ambiguous menu request: %s", async (query) => {
  const body = await (await ask(request(query))).json();
  expect(body.toolsUsed).toEqual(["venue_drinks"]);
  expect(body.cards).toEqual([]);
  expect(body.answer).toMatch(/listed pub/i);
});

it.each(NAMED_MENU_PRICE_REQUESTS)("executes the formerly refused named lookup: $query", async ({ query }) => {
  for (const post of [ask, chat]) {
    const body = await (await post(request(query))).json();
    expect(body.toolsUsed).toEqual(["venue_drinks"]);
    for (const card of body.cards) expect(card.menuEvidence).toMatchObject({ kind: "published-menu", currency: "GBP", availability: "unknown" });
    expect(body.answer).toMatch(/accepted menu|published serving|Serving size not recorded/i);
    expect(body.answer).not.toMatch(/can't compare|can't verify|not prices for that item/i);
  }
});

it("preserves item facts through the actual chat session consumer", async () => {
  const session = createPalChatSession({ fetchImpl: async (_url, init) => chat(new Request("http://localhost/api/pub-pal/chat", init)) });
  const body = await session("Mixed Olives price and calories at The New Inn", "london");
  expect(body).toMatchObject({ status: "answered", cards: [{ menuEvidence: { caloriesKcal: 163, dietary: ["vegan", "vegetarian"] }, provenance: { kind: "published-menu" } }] });
});

it.each([
  "Are there any Tube delays?",
  "Wine prices at Fox and Anchor and are there any Tube delays?",
  "Are there any Tube delays and wine prices at Fox and Anchor?",
])("separates transit interrogatives: %s", (query) => {
  expect(routeAskDeterministically(query).map((call) => call.name)).toContain("city_status");
  if (query.includes("Wine") || query.includes("wine")) {
    expect(resolveAskPriceIntent(query)).toMatchObject({ kind: "recorded-drinks", venueName: "Fox and Anchor", category: "wine" });
  }
});

it.each([
  "Wine prices at Fox and Anchor and are there any Tube delays?",
  "Are there any Tube delays and wine prices at Fox and Anchor?",
])("keeps transit and price authority through public and webhook paths: %s", async (query) => {
  const body = await (await ask(request(query))).json();
  expect(body.toolsUsed).toEqual(["city_status", "venue_drinks"]);
  expect(body.answer).toContain("Fox and Anchor");
  expect(body.answer).toContain("City status is unavailable just now.");
  const result = await runAskTool("venue_prices", { venueName: "The Lamb" }, { cityId: "london", query, skipModel: true });
  expect(result.tool).toBe("venue_drinks");
  expect(result.data).toMatchObject({ venueId: "venue-phg4ss", listedPint: null });
  await registerPubPalToolTurn("conv_transitdeterminer01", { query, cityId: "london", ownerId: "menu-owner" });
  vi.stubEnv("ELEVENLABS_LLM_SHARED_SECRET", "offline-test-secret");
  const response = await webhook(new Request("http://localhost/api/pub-pal/tools/venue_prices", {
    method: "POST", headers: { "content-type": "application/json", authorization: "Bearer offline-test-secret" },
    body: JSON.stringify({ conversation_id: "conv_transitdeterminer01", parameters: { query: "Pint at The Lamb", venueName: "The Lamb" } }),
  }), { params: Promise.resolve({ toolName: "venue_prices" }) });
  expect((await response.json()).result).toMatchObject({ tool: "venue_drinks" });
});

it.each(["Wine prices at Fox and Anchor near the Tube", "Find pubs near the Tube", "Are there any pubs near the Tube?"])("keeps Tube proximity outside status: %s", (query) => {
  expect(routeAskDeterministically(query).map((call) => call.name)).not.toContain("city_status");
});

it.each(JOURNEY_ENDPOINT_REQUESTS)("retains named journey authority: $query", async ({ query, from, to }) => {
  resetJourneyCache();
  const transport = vi.fn<typeof fetch>(async () => Response.json({ jsonrpc: "2.0", result: { structuredContent: { journeys: [{ durationMinutes: 12, legs: [] }] } } }));
  const result = await runAskTool("journey", { from: "Soho", to: "Camden" }, { cityId: "london", query, skipModel: true, fetchImpl: transport });
  expect(result.cards).toHaveLength(1);
  const [, init] = transport.mock.calls[0]!;
  expect(JSON.parse(init?.body as string).params.arguments).toEqual({ from, to });
});

it("uses the stored question instead of provider venue and item rewrites", async () => {
  const conversationId = "conv_menuregression01";
  await registerPubPalToolTurn(conversationId, { query: "Price of Mixed Olives at The New Inn", cityId: "london", ownerId: "menu-owner", cards: [], hints: [], proposals: [] });
  vi.stubEnv("ELEVENLABS_LLM_SHARED_SECRET", "offline-test-secret");
  const response = await webhook(new Request("http://localhost/api/pub-pal/tools/venue_prices", {
    method: "POST", headers: { "content-type": "application/json", authorization: "Bearer offline-test-secret" },
    body: JSON.stringify({ conversation_id: conversationId, parameters: { query: "Coke at The Eagle", venueName: "The Eagle" } }),
  }), { params: Promise.resolve({ toolName: "venue_prices" }) });
  const { result } = await response.json();
  expect(result.cards).toContainEqual(expect.objectContaining({ venueId: "venue-17qpap6", price: 5 }));
  const replay = await readOwnedPubPalToolTurn(conversationId, "menu-owner");
  expect(replay?.cards).toEqual(result.cards);
  expect(await readOwnedPubPalToolTurn(conversationId, "another-owner")).toBeNull();
});

it("intercepts configured menu queries without calling the provider", async () => {
  vi.stubEnv("ELEVENLABS_API_KEY", "offline-test-key");
  vi.stubEnv("ELEVENLABS_PUB_PAL_AGENT_ID", "offline-agent");
  const fetcher = vi.fn(() => { throw new Error("No provider request permitted"); });
  vi.stubGlobal("fetch", fetcher);
  const result = await runPalElevenLabsChatTurn({ query: "Price of Mixed Olives at The New Inn", cityId: "london", ownerId: "menu-owner" });
  expect(result).toMatchObject({ ok: true, cards: expect.arrayContaining([expect.objectContaining({ price: 5 })]) });
  expect(fetcher).not.toHaveBeenCalled();
});

it("stores configured intercepted evidence in the owner's existing thread", async () => {
  await registerPubPalToolTurn("conv_menureplay01", { query: "Earlier outing", cityId: "london", ownerId: "menu-owner" });
  vi.stubEnv("ELEVENLABS_API_KEY", "offline-test-key");
  vi.stubEnv("ELEVENLABS_PUB_PAL_AGENT_ID", "offline-agent");
  const query = "Mixed Olives calories and price at The New Inn";
  const result = await runPalElevenLabsChatTurn({ query, cityId: "london", ownerId: "menu-owner", threadId: "conv_menureplay01" });
  expect(result).toMatchObject({ ok: true, conversationId: "conv_menureplay01" });
  const replay = await readOwnedPubPalToolTurn("conv_menureplay01", "menu-owner");
  expect(replay).toMatchObject({ query, cards: [{ price: 5, menuEvidence: { caloriesKcal: 163 } }] });
  expect(await readOwnedPubPalToolTurn("conv_menureplay01", "another-owner")).toBeNull();
});
