import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({
  clientIp: () => "203.0.113.84",
  hashIp: (ip: string) => `hashed:${ip}`,
  isSupabaseConfigured: () => false,
  requiresSupabaseStore: () => false,
  checkRateLimitDurableDetailed: async () => ({ verdict: false, reason: "counted" }),
}));
vi.mock("@/lib/authServer", () => ({ callerUserId: async () => "11111111-1111-4111-8111-111111111111" }));
vi.mock("@/lib/paidSpendBudget.server", () => ({
  paidSpendBudgetRefusal: vi.fn(async () => Response.json({ error: "Paid budget spent" }, { status: 429 })),
}));
vi.mock("@/lib/concierge/venues.server", () => ({ loadConciergeVenues: vi.fn() }));
vi.mock("@/lib/palConfirmedMemories.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/palConfirmedMemories.server")>()),
  readConfirmedPalMemories: vi.fn(),
}));
vi.mock("@/lib/palTaste.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/palTaste.server")>()),
  readPalTaste: vi.fn(),
}));

import { POST } from "@/app/api/pub-pal/chat/route";
import { loadConciergeVenues } from "@/lib/concierge/venues.server";
import type { ConciergeVenue } from "@/lib/concierge/rank";
import { readConfirmedPalMemories } from "@/lib/palConfirmedMemories.server";
import { paidSpendBudgetRefusal } from "@/lib/paidSpendBudget.server";
import { readPalTaste } from "@/lib/palTaste.server";
import { __resetPintDrops } from "@/lib/pintDrops";
import { __resetPubPalToolTurnStore, registerPubPalToolTurn } from "@/lib/pubPalToolTurnStore";

const OWNER = "11111111-1111-4111-8111-111111111111";
const THREAD = "conv_venueadmit01";
const FOOD_PRICE_REFUSAL = "I can't compare meal prices or check dietary options yet. I can help you find pubs with food.";
const deniedFetch = vi.fn(async () => { throw new Error("External services are denied"); });
const deniedSocket = vi.fn(function deniedSocket() { throw new Error("Provider conversations are denied"); });

function listedPub(id: string, name: string, area: string, lat: number, lng: number, cheapestPrice: number): ConciergeVenue {
  return {
    id, name, searchText: `${name} ${area}`, area, lat, lng,
    cheapestPrice, priceSource: `https://example.com/listed-pints/${id}`, priceObservedAt: "2026-10-21",
    amenities: { beerGarden: false, food: true, cocktails: false, liveSports: false, liveMusic: false },
    nearWater: false, hasStory: false, canonical: true,
  };
}

// One-word, conjoined, "of", article-free and apostrophe name shapes.
const NAMED_PUBS = [
  listedPub("pva-lamb-bloomsbury", "The Lamb", "Bloomsbury", 51.5232, -0.1185, 5.9),
  listedPub("pva-fox-anchor-farringdon", "Fox and Anchor", "Farringdon", 51.5203, -0.101, 6.2),
  listedPub("pva-pow-feathers-fitzrovia", "Prince of Wales Feathers", "Fitzrovia", 51.5242, -0.1395, 5.8),
  listedPub("pva-lamb-flag-covent-garden", "Lamb and Flag", "Covent Garden", 51.5117, -0.126, 6.4),
  listedPub("pva-kings-arms-waterloo", "King's Arms", "Waterloo", 51.504, -0.1088, 5.6),
];

const SOHO_PUBS = [
  listedPub("pva-soho-coach-horses", "Coach and Horses", "Soho", 51.5129, -0.1316, 5.7),
  listedPub("pva-soho-french-house", "The French House", "Soho", 51.513, -0.1331, 6.5),
  listedPub("pva-soho-dog-duck", "Dog and Duck", "Soho", 51.5141, -0.1316, 6.1),
  listedPub("pva-soho-blue-posts", "The Blue Posts", "Soho", 51.5133, -0.1352, 6),
];

// Two different pubs share one name, so a lookup by it must ask which.
const EAGLE_PUBS = [
  listedPub("pva-eagle-clerkenwell", "The Eagle", "Clerkenwell", 51.5246, -0.1093, 5.9),
  listedPub("pva-eagle-islington", "The Eagle", "Islington", 51.5317, -0.0926, 6.1),
];

const VENUES = [...NAMED_PUBS, ...SOHO_PUBS, ...EAGLE_PUBS];

function ask(query: string, threadId?: string) {
  return POST(new Request("http://localhost/api/pub-pal/chat", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, cityId: "london", threadId }),
  }));
}

async function expectProviderAdmission(response: Response) {
  expect(response.status).toBe(429);
  expect(await response.json()).toEqual({ error: "Paid budget spent" });
  expect(paidSpendBudgetRefusal).toHaveBeenCalledOnce();
  expect(deniedFetch).not.toHaveBeenCalled();
  expect(deniedSocket).not.toHaveBeenCalled();
}

async function expectLocalRecords(response: Response, tool: "venue_drinks" | "search_venues") {
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body).toMatchObject({ toolsUsed: [tool] });
  expect(paidSpendBudgetRefusal).not.toHaveBeenCalled();
  expect(deniedFetch).not.toHaveBeenCalled();
  expect(deniedSocket).not.toHaveBeenCalled();
  return body;
}

beforeEach(() => {
  __resetPintDrops();
  __resetPubPalToolTurnStore();
  for (const key of ["TYPESAFE_API_KEY", "OPENROUTER_API_KEY", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) vi.stubEnv(key, "");
  vi.stubEnv("ELEVENLABS_API_KEY", "test-key");
  vi.stubEnv("ELEVENLABS_PUB_PAL_AGENT_ID", "agent-id");
  deniedFetch.mockClear();
  deniedSocket.mockClear();
  vi.stubGlobal("fetch", deniedFetch);
  vi.stubGlobal("WebSocket", deniedSocket);
  vi.mocked(loadConciergeVenues).mockReset().mockResolvedValue(VENUES);
  vi.mocked(readConfirmedPalMemories).mockReset().mockResolvedValue([]);
  vi.mocked(readPalTaste).mockReset().mockResolvedValue(null);
  vi.mocked(paidSpendBudgetRefusal).mockClear();
});

afterEach(() => {
  __resetPubPalToolTurnStore();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const ACTION_TAILS = [
  "Wine prices at The Lamb and contact Alice",
  "Wine prices at The Lamb and sing",
  "Wine prices at Fox and Anchor and juggle",
  "Wine prices at The Lamb and plan a crawl",
  "Wine prices at Fox and Anchor and plan a crawl",
  "Wine prices at The Lamb and show four pubs in Soho",
];

// A sample of verbs no local tool performs, not a list the code should block.
const UNSEEN_VERB_TAILS = [
  "Wine prices at The Lamb and dance",
  "Wine prices at King's Arms and phone Bob",
  "Wine prices at Lamb and Flag and whistle",
  "Wine prices at Prince of Wales Feathers and recite a poem",
];

const UNLISTED_ORDINARY_NAMES = ["Wine prices at The Local", "Wine prices at Good Place"];

const OWNED_ACTION_PRIORS = [
  "Wine prices at The Lamb and contact Alice",
  "Wine prices at Kings Arms and email Priya",
  "Wine prices at Fox and Anchor and juggle",
  "Wine prices at The Lamb and plan a crawl",
  "Wine prices at Fox and Anchor and plan a crawl",
];

// Each ask beside the fixture name its answer must carry.
const SUPPORTED_NAMES: Array<[query: string, name: string]> = [
  ["Wine prices at Fox and Anchor", "Fox and Anchor"],
  ["Wine prices at Prince of Wales Feathers", "Prince of Wales Feathers"],
  ["Wine prices at The Lamb and Flag", "Lamb and Flag"],
  ["Wine prices at Lamb & Flag", "Lamb and Flag"],
  ["Wine prices at King's Arms", "King's Arms"],
  ["Wine prices at Kings Arms", "King's Arms"],
  ["Wine prices at The Lamb", "The Lamb"],
];

// Existing request vocabulary after a listed name, which is not part of the name.
const SUPPORTED_NAME_QUALIFIERS: Array<[query: string, name: string]> = [
  ["Wine prices at Fox and Anchor please", "Fox and Anchor"],
  ["Wine prices at Fox and Anchor tonight", "Fox and Anchor"],
  ["Wine prices at Fox and Anchor for four", "Fox and Anchor"],
];

describe("venue names beside sibling actions over configured HTTP", () => {
  it.each(ACTION_TAILS)("keeps an action after a venue name on the provider path: %s", async (query) => {
    await expectProviderAdmission(await ask(query));
  });

  it.each(UNSEEN_VERB_TAILS)("keeps an unseen action verb after a venue name on the provider path: %s", async (query) => {
    await expectProviderAdmission(await ask(query));
  });

  it.each(OWNED_ACTION_PRIORS)("keeps an owned prior action on the provider path behind a bare please: %s", async (prior) => {
    await registerPubPalToolTurn(THREAD, { query: prior, cityId: "london", ownerId: OWNER, turns: [] });
    await expectProviderAdmission(await ask("please", THREAD));
  });

  it("keeps an owned prior action on the provider path behind a new recommendation", async () => {
    await registerPubPalToolTurn(THREAD, { query: "Wine prices at The Lamb and contact Alice", cityId: "london", ownerId: OWNER, turns: [] });
    await expectProviderAdmission(await ask("Find four pubs at Soho", THREAD));
  });

  it("keeps an owned prior supported second action on the provider path behind a new recommendation", async () => {
    await registerPubPalToolTurn(THREAD, { query: "Wine prices at The Lamb and plan a crawl", cityId: "london", ownerId: OWNER, turns: [] });
    await expectProviderAdmission(await ask("Find four pubs at Soho", THREAD));
  });
});

describe("venue names the records do not list over configured HTTP", () => {
  it.each(UNLISTED_ORDINARY_NAMES)("keeps an unlisted name made of request words on the provider path: %s", async (query) => {
    await expectProviderAdmission(await ask(query));
  });

  it("keeps an owned prior unlisted name on the provider path behind a new recommendation", async () => {
    await registerPubPalToolTurn(THREAD, { query: "Wine prices at The Local", cityId: "london", ownerId: OWNER, turns: [] });
    await expectProviderAdmission(await ask("Find four pubs at Soho", THREAD));
  });
});

describe("listed venue names and area discovery over configured HTTP", () => {
  it.each(SUPPORTED_NAMES)("answers a listed venue from the records: %s", async (query, name) => {
    const body = await expectLocalRecords(await ask(query), "venue_drinks");
    expect(body.answer).toContain(name);
  });

  it.each(SUPPORTED_NAME_QUALIFIERS)("answers a listed venue beside a request qualifier from the records: %s", async (query, name) => {
    const body = await expectLocalRecords(await ask(query), "venue_drinks");
    expect(body.answer).toContain(name);
  });

  it("answers an owned please after a listed venue from the records", async () => {
    await registerPubPalToolTurn(THREAD, { query: "Wine prices at Fox and Anchor", cityId: "london", ownerId: OWNER, turns: [] });
    const body = await expectLocalRecords(await ask("please", THREAD), "venue_drinks");
    expect(body.conversationId).toBe(THREAD);
    expect(body.answer).toContain("Fox and Anchor");
  });

  it("discovers Soho pubs at an area without reading the area as a pub name", async () => {
    await expectLocalRecords(await ask("Find four pubs at Soho"), "search_venues");
  });

  it("answers a new recommendation after an owned listed venue lookup from the records", async () => {
    await registerPubPalToolTurn(THREAD, { query: "Wine prices at Fox and Anchor", cityId: "london", ownerId: OWNER, turns: [] });
    await expectLocalRecords(await ask("Find four pubs at Soho", THREAD), "search_venues");
  });

  it("asks which listed pub a shared name means from the records", async () => {
    const body = await expectLocalRecords(await ask("Price of Coke at The Eagle"), "venue_drinks");
    expect(body.cards).toEqual([]);
    expect(body.answer).toMatch(/listed pub/);
  });
});

describe("unsupported factual price subjects over configured HTTP", () => {
  it("refuses a pint and food price at a named venue locally with the exact coverage answer", async () => {
    const response = await ask("How much is a pint and food at The Lamb?");
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.answer).toBe(FOOD_PRICE_REFUSAL);
    expect(body).toMatchObject({ cards: [], proposals: [], toolsUsed: [] });
    expect(paidSpendBudgetRefusal).not.toHaveBeenCalled();
    expect(deniedFetch).not.toHaveBeenCalled();
    expect(deniedSocket).not.toHaveBeenCalled();
  });

  it("refuses a pint and food price at a named venue beside a supported area locally with the exact coverage answer", async () => {
    const response = await ask("How much is a pint and food at The Lamb in Camden?");
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.answer).toBe(FOOD_PRICE_REFUSAL);
    expect(body).toMatchObject({ cards: [], proposals: [], toolsUsed: [] });
    expect(paidSpendBudgetRefusal).not.toHaveBeenCalled();
    expect(deniedFetch).not.toHaveBeenCalled();
    expect(deniedSocket).not.toHaveBeenCalled();
  });

  it("keeps a planning action after a pint and food price at a named venue on the provider path", async () => {
    await expectProviderAdmission(await ask("How much is a pint and food at The Lamb and plan a crawl"));
  });
});
