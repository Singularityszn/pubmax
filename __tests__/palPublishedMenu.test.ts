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
import { parseDrinkPriceUpdates } from "@/lib/drinkPriceUpdates";
import { publishedMenuCards, publishedMenuAnswer } from "@/lib/ask/publishedMenu.server";
import type { AskCard } from "@/lib/ask/types";

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

const portionCases = [
  { query: "Price of 8oz Bavette steak at The New Inn", venueId: "venue-17qpap6", item: "8oz Bavette steak", price: 23, caloriesKcal: 1394,
    source: "The New Inn - official published menu", sourceUrl: "https://www.newinnealing.com/food-and-drink", observedAt: "2026-10-13T09:43:11.443Z" },
  { query: "Price of 10oz West Country Ribeye Steak at The Eagle, Hammersmith and Fulham", venueId: "venue-1hz0avt", item: "10oz West Country Ribeye Steak", price: 44, caloriesKcal: 776,
    source: "The Eagle - official published menu", sourceUrl: "https://www.theeaglew12.co.uk/food-drink", observedAt: "2026-10-13T06:51:38.364Z" },
] as const;
const portionRequests = portionCases.flatMap((record) => [
  { ...record, accepted: true },
  { ...record, query: record.query.replace("oz", " oz"), accepted: true },
  { ...record, query: record.query.replace(/\d+oz/, "12oz"), accepted: false },
  { ...record, query: record.query.replace(/\d+oz/, "-8oz"), accepted: false },
  { ...record, query: record.query.replace(/\d+oz/, "0.8oz"), accepted: false },
  { ...record, query: record.query.replace(/\d+oz/, "8oz glass"), accepted: false },
  { ...record, query: record.query.replace(/\d+oz/, "125ml"), accepted: false },
  { ...record, query: record.query.replace("Price of", "Vegan gluten-free price of"), accepted: false },
  { ...record, query: `Is ${record.item} vegan at ${record.query.split(" at ")[1]}?`, accepted: true },
]);
portionRequests.push({ ...portionCases[0], query: "Price of 8oz Mixed Olives at The New Inn", accepted: false });

it.each(portionRequests.flatMap((record) => ["reader", "ask", "keyless chat", "chat session", "tool dispatch", "configured chat", "stored webhook"]
  .map((boundary) => ({ ...record, boundary }))))("preserves food portion identity through $boundary: $query", async (record) => {
  const { query, venueId, boundary } = record;
  let cards: AskCard[];
  let answer: string | undefined;
  if (boundary === "reader") {
    ({ cards } = await publishedMenuCards(venueId, query));
    answer = publishedMenuAnswer(cards);
  } else if (boundary === "ask" || boundary === "keyless chat") {
    const response = await (boundary === "ask" ? ask : chat)(request(query));
    expect(response.status).toBe(200);
    ({ cards, answer } = await response.json());
  } else if (boundary === "chat session") {
    const session = createPalChatSession({ fetchImpl: async (_url, init) => chat(new Request("http://localhost/api/pub-pal/chat", init)) });
    const result = await session(query, "london");
    if (!result || result.status === "error") throw new Error("Chat session returned no answer");
    ({ cards, message: answer } = result);
  } else if (boundary === "tool dispatch") {
    const result = await runAskTool("venue_prices", { venueName: "The Lamb", query: "Pint at The Lamb" }, { query, cityId: "london", skipModel: true });
    expect(result.tool).toBe("venue_drinks");
    ({ cards, answerHint: answer } = result);
  } else {
    await registerPubPalToolTurn("conv_foodportion01", { query, cityId: "london", ownerId: "menu-owner" });
    if (boundary === "configured chat") {
      vi.stubEnv("ELEVENLABS_API_KEY", "offline-test-key");
      vi.stubEnv("ELEVENLABS_PUB_PAL_AGENT_ID", "offline-agent");
      const fetcher = vi.fn(() => { throw new Error("No provider request permitted"); });
      vi.stubGlobal("fetch", fetcher);
      const result = await runPalElevenLabsChatTurn({ query, cityId: "london", ownerId: "menu-owner", threadId: "conv_foodportion01" });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("Configured interception failed");
      ({ cards, message: answer } = result);
      expect(fetcher).not.toHaveBeenCalled();
    } else {
      vi.stubEnv("ELEVENLABS_LLM_SHARED_SECRET", "offline-test-secret");
      const response = await webhook(new Request("http://localhost/api/pub-pal/tools/venue_prices", {
        method: "POST", headers: { "content-type": "application/json", authorization: "Bearer offline-test-secret" },
        body: JSON.stringify({ conversation_id: "conv_foodportion01", parameters: { query: "Mixed Olives price at The New Inn", venueName: "The New Inn" } }),
      }), { params: Promise.resolve({ toolName: "venue_prices" }) });
      expect(response.status).toBe(200);
      ({ cards, answerHint: answer } = (await response.json()).result);
    }
    const replay = await readOwnedPubPalToolTurn("conv_foodportion01", "menu-owner");
    expect(replay?.query).toBe(query);
    expect(replay?.cards).toEqual(cards);
    expect(replay?.hints).toContain(answer);
    expect(await readOwnedPubPalToolTurn("conv_foodportion01", "another-owner")).toBeNull();
  }
  if (!record.accepted) {
    expect(cards).toEqual([]);
    if (boundary !== "reader") expect(answer).toContain("No accepted menu item matches");
    return;
  }
  expect(cards).toHaveLength(1);
  expect(cards[0]).toMatchObject({ venueId, price: record.price,
    menuEvidence: { itemName: record.item, menu: "food", currency: "GBP", serving: null, caloriesKcal: record.caloriesKcal,
      source: record.source, sourceUrl: record.sourceUrl, observedAt: record.observedAt, dietary: [], dietaryProvenance: null,
      caloriesProvenance: { source: record.source, sourceUrl: record.sourceUrl, observedAt: record.observedAt }, availability: "unknown" },
    provenance: { kind: "published-menu", label: record.source, url: record.sourceUrl },
  });
  expect(answer).toContain(`${record.item} at`);
  expect(answer).toContain(`£${record.price.toFixed(2)}`);
  expect(answer).toContain(`${record.caloriesKcal} kcal published for this item.`);
  expect(answer).toContain(`Price observed ${record.observedAt.slice(0, 10)}.`);
  expect(answer).toContain("Serving size not recorded.");
  expect(answer).toContain("Dietary labels not recorded.");
  expect(answer).toContain("Availability unknown.");
  expect(answer).not.toMatch(/allergy.safe|in stock/i);
});

const dietaryBoundaries = ["reader", "ask", "keyless chat", "chat session", "tool dispatch", "configured chat", "stored webhook"] as const;
const dietaryCases = [
  ["Vegan gluten-free options at The New Inn", null],
  ["Gluten free vegan options at The New Inn", null],
  ["Vegetarian gluten-free options at The New Inn", null],
  ["Vegan vegetarian gluten-free options at The New Inn", null],
  ["Vegan sausage roll price at The New Inn", null],
  ["Vegetarian sausage roll price at The New Inn", null],
  ["Gluten-free Mixed Olives price at The New Inn", null],
  ["Vegan gluten-free Mixed Olives price at The New Inn", null],
  ["Vegan 125ml Steinbock Riesling price at The Eagle, Hammersmith and Fulham", null],
  ["Vegan vegetarian Mixed Olives price at The New Inn", "Mixed Olives"],
  ["Vegetarian vegan Mixed Olives price at The New Inn", "Mixed Olives"],
  ["Is Classic sausage roll vegan at The New Inn?", "Classic sausage roll"],
  ["Is Classic sausage roll vegetarian and gluten-free at The New Inn?", "Classic sausage roll"],
  ["Is vegan Classic sausage roll gluten-free at The New Inn?", null],
  ["Are Mixed Olives vegan and gluten-free at The New Inn?", "Mixed Olives"],
  ["Dietary labels for Classic sausage roll at The New Inn", "Classic sausage roll"],
  ["Classic sausage roll price at The New Inn", "Classic sausage roll"],
] as const;

it.each(dietaryCases.flatMap(([query, item]) => dietaryBoundaries.map((boundary) => ({ query, item, boundary }))))(
  "preserves dietary request authority through $boundary: $query", async ({ query, item, boundary }) => {
    let cards: AskCard[];
    let answer: string | undefined;
    if (boundary === "reader") {
      ({ cards } = await publishedMenuCards(query.includes("The Eagle") ? "venue-1hz0avt" : "venue-17qpap6", query));
      answer = publishedMenuAnswer(cards);
    } else if (boundary === "ask" || boundary === "keyless chat") {
      const response = await (boundary === "ask" ? ask : chat)(request(query));
      expect(response.status).toBe(200);
      ({ cards, answer } = await response.json());
    } else if (boundary === "chat session") {
      const session = createPalChatSession({ fetchImpl: async (_url, init) => chat(new Request("http://localhost/api/pub-pal/chat", init)) });
      const result = await session(query, "london");
      if (!result || result.status === "error") throw new Error("Chat session returned no answer");
      ({ cards, message: answer } = result);
    } else if (boundary === "tool dispatch") {
      const result = await runAskTool("venue_prices", { venueName: "The Lamb", query: "Pint at The Lamb" }, { query, cityId: "london", skipModel: true });
      expect(result.tool).toBe("venue_drinks");
      ({ cards, answerHint: answer } = result);
    } else {
      await registerPubPalToolTurn("conv_dietaryauthority01", { query, cityId: "london", ownerId: "menu-owner" });
      if (boundary === "configured chat") {
        vi.stubEnv("ELEVENLABS_API_KEY", "offline-test-key");
        vi.stubEnv("ELEVENLABS_PUB_PAL_AGENT_ID", "offline-agent");
        const fetcher = vi.fn(() => { throw new Error("No provider request permitted"); });
        vi.stubGlobal("fetch", fetcher);
        const result = await runPalElevenLabsChatTurn({ query, cityId: "london", ownerId: "menu-owner", threadId: "conv_dietaryauthority01" });
        expect(result.ok).toBe(true);
        if (!result.ok) throw new Error("Configured interception failed");
        ({ cards, message: answer } = result);
        expect(fetcher).not.toHaveBeenCalled();
      } else {
        vi.stubEnv("ELEVENLABS_LLM_SHARED_SECRET", "offline-test-secret");
        const response = await webhook(new Request("http://localhost/api/pub-pal/tools/venue_prices", {
          method: "POST", headers: { "content-type": "application/json", authorization: "Bearer offline-test-secret" },
          body: JSON.stringify({ conversation_id: "conv_dietaryauthority01", parameters: { query: "Mixed Olives price at The New Inn", venueName: "The New Inn" } }),
        }), { params: Promise.resolve({ toolName: "venue_prices" }) });
        expect(response.status).toBe(200);
        ({ cards, answerHint: answer } = (await response.json()).result);
      }
      const replay = await readOwnedPubPalToolTurn("conv_dietaryauthority01", "menu-owner");
      expect(replay?.query).toBe(query);
      expect(replay?.cards).toEqual(cards);
      expect(replay?.hints).toContain(answer);
      expect(await readOwnedPubPalToolTurn("conv_dietaryauthority01", "another-owner")).toBeNull();
    }
    if (item === null) {
      expect(cards).toEqual([]);
      if (boundary !== "reader") expect(answer).toContain("No accepted menu item matches");
    } else {
      expect(cards).toHaveLength(1);
      expect(cards[0]).toMatchObject({ venueId: "venue-17qpap6", price: item === "Mixed Olives" ? 5 : 5.5,
        menuEvidence: { itemName: item, currency: "GBP", serving: null, availability: "unknown",
          caloriesKcal: item === "Mixed Olives" ? 163 : 314,
          dietary: item === "Mixed Olives" ? ["vegan", "vegetarian"] : [],
          observedAt: "2026-10-13T09:43:11.443Z", sourceUrl: "https://www.newinnealing.com/food-and-drink",
          caloriesProvenance: { source: "The New Inn - official published menu", sourceUrl: "https://www.newinnealing.com/food-and-drink", observedAt: "2026-10-13T09:43:11.443Z" },
          dietaryProvenance: item === "Mixed Olives" ? expect.objectContaining({ sourceUrl: "https://www.newinnealing.com/food-and-drink", observedAt: "2026-10-13T09:43:11.443Z" }) : null,
        },
      });
      expect(answer).toContain(item === "Mixed Olives" ? "Publisher labels: vegan, vegetarian." : "Dietary labels not recorded.");
      expect(answer).not.toMatch(/allergy.safe|in stock|gluten.free\./i);
    }
  },
);

it.each([
  ["Vegan vegetarian gluten-free options at The New Inn", ["All labels fixture"]],
  ["Gluten free vegetarian vegan options at The New Inn", ["All labels fixture"]],
  ["Vegan options at The New Inn", ["All labels fixture", "First fixture"]],
  ["Vegetarian options at The New Inn", ["All labels fixture", "Second fixture"]],
  ["Gluten-free options at The New Inn", ["All labels fixture"]],
  ["Vegetarian First fixture price at The New Inn", []],
  ["Vegan Second fixture price at The New Inn", []],
] as const)("requires explicit dietary fixture evidence for every condition: %s", async (query, expectedNames) => {
  const food = parseFoodPriceUpdates([
    { itemName: "All labels fixture", dietary: ["vegan", "vegetarian", "gluten-free"] },
    { itemName: "First fixture", dietary: ["vegan"] },
    { itemName: "Second fixture", dietary: ["vegetarian"] },
    { itemName: "Unknown labels fixture" },
  ].map((item) => ({ ...item, venueKey: "the new inn|62 st mary's rd, london w5 5ex, uk|51.50500|-0.30568",
    category: "other", priceGbp: 1, caloriesKcal: 0,
    source: { label: "Explicit dietary fixture", licence: "Test only", url: "https://example.com/dietary" },
    observedAt: "2026-10-13T09:43:11.443Z",
  })));
  expect(food).toHaveLength(4);
  vi.spyOn(priceUpdates, "venuePriceUpdatesFor").mockResolvedValue({ food, drink: [] });
  const { cards } = await publishedMenuCards("venue-17qpap6", query);
  expect(cards.map((card) => card.menuEvidence?.itemName)).toEqual(expectedNames);
  for (const card of cards) expect(card.menuEvidence).toMatchObject({ caloriesKcal: 0,
    dietaryProvenance: { sourceUrl: "https://example.com/dietary" },
  });
});

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

it("returns the published Sherlock Holmes cards expected by both browser viewports", async () => {
  const body = await (await chat(request("Wine prices at Sherlock Holmes"))).json();
  expect(body.cards).toHaveLength(8);
  expect(body.cards).toContainEqual(expect.objectContaining({ venueId: "venue-gk2fp9", price: 7.2,
    menuEvidence: expect.objectContaining({ itemName: "Organic Pinot Grigio, Riff, Italy", serving: null, observedAt: "2026-09-21T18:41:07.759Z" }),
    provenance: expect.objectContaining({ kind: "published-menu", url: "https://www.greeneking.co.uk/pubs/greater-london/sherlock-holmes/menu" }),
  }));
  expect(body.answer).toContain("£7.20");
  expect(body.answer).toContain("Serving size not recorded");
  expect(body.proposals).toContainEqual(expect.objectContaining({ kind: "open_venue", venueId: "venue-gk2fp9" }));
});

it.each([
  ["Price of 125 ml Steinbock Riesling at The Eagle, Hammersmith and Fulham", 7.1, "125ml", null],
  ["Price of 750 ml Steinbock Riesling at The Eagle, Hammersmith and Fulham", 35.5, "750ml", null],
  ["Price of 50ml Steinbock Riesling at The Eagle, Hammersmith and Fulham", null, null, null],
  ["Price of -125ml Steinbock Riesling at The Eagle, Hammersmith and Fulham", null, null, null],
  ["Price of 1,25ml Steinbock Riesling at The Eagle, Hammersmith and Fulham", null, null, null],
  ["Price of 0ml Steinbock Riesling at The Eagle, Hammersmith and Fulham", null, null, null],
  ["Price of 125ml bottle Steinbock Riesling at The Eagle, Hammersmith and Fulham", null, null, null],
  ["Price of a glass of Organic Pinot Grigio at Sherlock Holmes", null, null, null],
  ["Price of a bottle of Apple and Elderflower at The Eagle, Hammersmith and Fulham", null, null, null],
  ["How many calories are in Mixed Olives at The New Inn?", 5, null, 163],
  ["How many calories are there in Mixed Olives at The New Inn?", 5, null, 163],
  ["How many calories does Mixed Olives have at The New Inn?", 5, null, 163],
  ["How many calories do Mixed Olives contain at The New Inn?", 5, null, 163],
  ["How many kcal in Mixed Olives at The New Inn?", 5, null, 163],
  ["What is the calorie count for Mixed Olives at The New Inn?", 5, null, 163],
  ["What's the calorie content of Mixed Olives at The New Inn?", 5, null, 163],
  ["What are the published calories in Mixed Olives at The New Inn?", 5, null, 163],
] as const)("preserves serving and calorie identity through every menu boundary: %s", async (query, price, serving, caloriesKcal) => {
  const expected = price === null ? [] : [expect.objectContaining({ price,
    venueId: caloriesKcal === 163 ? "venue-17qpap6" : "venue-1hz0avt",
    menuEvidence: expect.objectContaining({ serving, caloriesKcal, currency: "GBP", availability: "unknown",
      itemName: caloriesKcal === 163 ? "Mixed Olives" : "Steinbock, Riesling, Germany",
      dietary: caloriesKcal === 163 ? ["vegan", "vegetarian"] : [],
      observedAt: caloriesKcal === 163 ? "2026-10-13T09:43:11.443Z" : "2026-10-13T10:19:25.911Z",
    }),
  })];
  for (const post of [ask, chat]) {
    const response = await post(request(query));
    expect(response.status).toBe(200);
    expect((await response.json()).cards).toEqual(expected);
  }
  const session = createPalChatSession({ fetchImpl: async (_url, init) => chat(new Request("http://localhost/api/pub-pal/chat", init)) });
  const chatResult = await session(query, "london");
  if (!chatResult || chatResult.status === "error") throw new Error("Chat session returned no answer");
  expect(chatResult.cards).toEqual(expected);
  await registerPubPalToolTurn("conv_menuboundaries01", { query, cityId: "london", ownerId: "menu-owner" });
  vi.stubEnv("ELEVENLABS_LLM_SHARED_SECRET", "offline-test-secret");
  const response = await webhook(new Request("http://localhost/api/pub-pal/tools/venue_prices", {
    method: "POST", headers: { "content-type": "application/json", authorization: "Bearer offline-test-secret" },
    body: JSON.stringify({ conversation_id: "conv_menuboundaries01", parameters: { query: "Coke at The Lamb", venueName: "The Lamb" } }),
  }), { params: Promise.resolve({ toolName: "venue_prices" }) });
  expect(response.status).toBe(200);
  const { result } = await response.json();
  expect(result.cards).toEqual(expected);
  expect((await readOwnedPubPalToolTurn("conv_menuboundaries01", "menu-owner"))?.cards).toEqual(result.cards);
  expect(await readOwnedPubPalToolTurn("conv_menuboundaries01", "other-owner")).toBeNull();
  vi.stubEnv("ELEVENLABS_API_KEY", "offline-test-key");
  vi.stubEnv("ELEVENLABS_PUB_PAL_AGENT_ID", "offline-agent");
  const fetcher = vi.fn(() => { throw new Error("No provider request permitted"); });
  vi.stubGlobal("fetch", fetcher);
  const intercepted = await runPalElevenLabsChatTurn({ query, cityId: "london", ownerId: "menu-owner", threadId: "conv_menuboundaries01" });
  expect(intercepted).toMatchObject({ ok: true, cards: expected });
  expect((await readOwnedPubPalToolTurn("conv_menuboundaries01", "menu-owner"))?.cards).toEqual(expected);
  expect(fetcher).not.toHaveBeenCalled();
});

it.each([
  ["25 cl", "25cl"], ["0.5 l", "0.5l"], ["1 oz", "1oz"],
  ["single", "single"], ["double", "double"], ["glass", "glass"],
  ["bottle", "bottle"], ["pint", "pint"], ["175 ml glass", "175ml glass"],
] as const)("matches complete measured and named fixture servings: %s", async (asked, servingSize) => {
  const drink = parseDrinkPriceUpdates([{
    venueKey: "the new inn|62 st mary's rd, london w5 5ex, uk|51.50500|-0.30568",
    drinkName: "Serving fixture", category: "wine", priceGbp: 2, servingSize,
    source: { label: "Explicit serving fixture", licence: "Test only", url: "https://example.com/fixture" },
    observedAt: "2026-10-13T09:43:11.443Z", lane: "publisher",
  }]);
  expect(drink).toHaveLength(1);
  vi.spyOn(priceUpdates, "venuePriceUpdatesFor").mockResolvedValue({ drink, food: [] });
  const body = await (await ask(request(`Price of ${asked} Serving fixture at The New Inn`))).json();
  expect(body.cards).toHaveLength(1);
  expect(body.cards[0]).toMatchObject({ price: 2, menuEvidence: { serving: servingSize, caloriesKcal: null, dietary: [] } });
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

it.each([
  { query: "How do I get from Kings Cross to Fox and Anchor?", from: "51.53000,-0.12400" },
  { query: "Directions to Fox and Anchor from Kings Cross", from: "51.53000,-0.12400" },
  { query: "Directions to Fox and Anchor", from: "51.50500,-0.08600" },
])("resolves supported station origins through both public APIs: $query", async ({ query, from }) => {
  resetJourneyCache();
  const transport = vi.fn<typeof fetch>(async (_input, init) => {
    const payload = JSON.parse(String(init?.body)) as { params: { arguments: { from: string; to: string } } };
    const points = payload.params.arguments;
    if (points.from !== from || points.to !== "51.52042,-0.10071") {
      return Response.json({ jsonrpc: "2.0", result: {
        isError: true,
        content: [{ type: "text", text: JSON.stringify({ _tag: "JourneyAmbiguous", ...points, candidates: ["Station entrance"] }) }],
      } });
    }
    return Response.json({ jsonrpc: "2.0", result: { structuredContent: {
      journeys: [{ durationMinutes: 12, legs: [{ mode: "walking", summary: "Walk to Fox and Anchor" }] }],
    } } });
  });
  vi.stubGlobal("fetch", transport);
  for (const handler of [ask, chat]) {
    const response = await handler(request(query));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.cards).toContainEqual(expect.objectContaining({ venueId: "venue-phg4ss", place: "Fox and Anchor", note: "12 min" }));
    expect(body.proposals).toContainEqual(expect.objectContaining({ kind: "open_venue", venueId: "venue-phg4ss" }));
  }
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
