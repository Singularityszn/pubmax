import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({
  clientIp: () => "203.0.113.83",
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

import { POST } from "@/app/api/pub-pal/chat/route";
import { loadConciergeVenues } from "@/lib/concierge/venues.server";
import type { ConciergeVenue } from "@/lib/concierge/rank";
import { palChatRecordQuery, preparePalElevenLabsChatTurn } from "@/lib/palElevenLabsChat.server";
import { paidSpendBudgetRefusal } from "@/lib/paidSpendBudget.server";
import { __resetPintDrops } from "@/lib/pintDrops";
import { __resetPubPalToolTurnStore, registerPubPalToolTurn } from "@/lib/pubPalToolTurnStore";

const OWNER = "11111111-1111-4111-8111-111111111111";
const THREAD = "conv_mixedmemory01";
const SOHO = "Find four pubs in Soho";
const deniedFetch = vi.fn(async () => { throw new Error("External services are denied"); });

function listedPub(id: string, name: string): ConciergeVenue {
  return {
    id, name, searchText: name, area: "Westminster", lat: 51.514, lng: -0.134,
    cheapestPrice: 5.5, priceSource: "https://example.com/menu", priceObservedAt: "2026-10-21",
    amenities: { beerGarden: true, food: true, cocktails: false, liveSports: false, liveMusic: false },
    nearWater: false, hasStory: false, canonical: true,
  };
}

const VENUES = [
  listedPub("soho-one", "Soho One"),
  listedPub("soho-two", "Soho Two"),
  listedPub("soho-three", "Soho Three"),
  listedPub("soho-four", "Soho Four"),
];

function ask(query: string, threadId?: string) {
  return POST(new Request("http://localhost/api/pub-pal/chat", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, cityId: "london", threadId }),
  }));
}

beforeEach(() => {
  __resetPintDrops();
  __resetPubPalToolTurnStore();
  for (const key of ["TYPESAFE_API_KEY", "OPENROUTER_API_KEY", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) vi.stubEnv(key, "");
  vi.stubEnv("ELEVENLABS_API_KEY", "test-key");
  vi.stubEnv("ELEVENLABS_PUB_PAL_AGENT_ID", "agent-id");
  deniedFetch.mockClear();
  vi.stubGlobal("fetch", deniedFetch);
  vi.mocked(loadConciergeVenues).mockResolvedValue(VENUES);
  vi.mocked(paidSpendBudgetRefusal).mockClear();
});

afterEach(() => {
  __resetPubPalToolTurnStore();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const MIXED_MEMORY = [
  "Find four pubs in Soho. Remember that I prefer gardens.",
  "Plan a crawl in Soho. Remember that I prefer gardens.",
  "Cheap pints near Soho. Remember that I prefer gardens.",
  "Cheapest wine in Soho. Remember that I prefer gardens.",
  "Remember that I like wine. Wine prices at Fox and Anchor",
];

describe("explicit memory requests beside local record answers", () => {
  it.each(MIXED_MEMORY)("keeps a direct memory request on the provider path: %s", async (query) => {
    expect(palChatRecordQuery(query)).toBeNull();
    const response = await ask(query);
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: "Paid budget spent" });
    expect(paidSpendBudgetRefusal).toHaveBeenCalledOnce();
    expect(deniedFetch).not.toHaveBeenCalled();
  });

  it.each(MIXED_MEMORY)("keeps an owned follow-up memory request on the provider path: %s", async (query) => {
    const followUp = query.replace(" in Soho", " in the same area");
    await registerPubPalToolTurn(THREAD, { query: SOHO, cityId: "london", ownerId: OWNER, turns: [] });
    const context = await preparePalElevenLabsChatTurn({ query: followUp, ownerId: OWNER, threadId: THREAD });
    expect(palChatRecordQuery(followUp, context.prior.turns)).toBeNull();
    const response = await ask(followUp, THREAD);
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: "Paid budget spent" });
    expect(paidSpendBudgetRefusal).toHaveBeenCalledOnce();
    expect(deniedFetch).not.toHaveBeenCalled();
  });

  it.each([
    ["Find four pubs in Soho with a garden", "search_venues"],
    ["Plan a crawl in Soho", "propose_plan"],
    ["Cheap pints near Soho", "search_venues"],
    ["Find four pubs in Soho", "search_venues"],
    ["Find four quiet pubs in Soho", "search_venues"],
    ["Find four pubs in Soho with food", "search_venues"],
    ["Find four pubs in Soho, not in Camden", "search_venues"],
    ["Find four pubs not in Camden but in Soho", "search_venues"],
    ["Find four pubs in Soho, not in Camden Town", "search_venues"],
    ["Find four pubs in Soho, not in Elephant and Castle", "search_venues"],
    ["Find two pubs in Soho for three of us", "search_venues"],
    ["A pub crawl in Soho for three, not pricey", "propose_plan"],
    ["Plan a three-stop crawl in Soho", "propose_plan"],
  ] as const)("keeps an ordinary records request local: %s", async (query, tool) => {
    expect(palChatRecordQuery(query)).toBe(query);
    const response = await ask(query);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ toolsUsed: [tool] });
    expect(paidSpendBudgetRefusal).not.toHaveBeenCalled();
    expect(deniedFetch).not.toHaveBeenCalled();
  });
});

const UNKNOWN_ADDITIONAL_ACTIONS = [
  "Find four pubs in Soho. Book a table.",
  "Wine prices at Fox and Anchor. Book a table.",
  "Cheapest wine in Soho and book us a table",
  "Plan a crawl in Soho for four of us, then reserve two seats",
  "Cheap pints near Soho. Order for the group.",
  "Find four pubs in Soho with a garden and text my mates",
  "Find four pubs in Soho and book tables",
  "Wine prices at Fox and Anchor and contact Alice",
  "Find four pubs in Soho, not in Camden then book a table",
  "Find four pubs in Soho, not in Camden, then book a table",
  "Find four pubs in Soho, not in Camden. Book a table.",
  "Find four pubs in Soho, not in Camden; book a table",
  "Find four pubs not in Camden but in Soho then book a table",
  "Find four pubs in Soho, not in Camden book a table",
  "Find four pubs in Soho, not in Camden Town then book a table",
  "Find four pubs in Soho, not in Elephant and Castle then book a table",
];

describe("unknown additional actions beside local record answers", () => {
  it.each(UNKNOWN_ADDITIONAL_ACTIONS)("keeps a direct extra action on the configured HTTP provider path: %s", async (query) => {
    const response = await ask(query);
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: "Paid budget spent" });
    expect(paidSpendBudgetRefusal).toHaveBeenCalledOnce();
    expect(deniedFetch).not.toHaveBeenCalled();
    expect(palChatRecordQuery(query)).toBeNull();
  });

  it.each(UNKNOWN_ADDITIONAL_ACTIONS)("keeps an owned follow-up extra action on the configured HTTP provider path: %s", async (query) => {
    const followUp = query.replace(/ (?:in|near) Soho/, " in the same area");
    await registerPubPalToolTurn(THREAD, { query: SOHO, cityId: "london", ownerId: OWNER, turns: [] });
    const context = await preparePalElevenLabsChatTurn({ query: followUp, ownerId: OWNER, threadId: THREAD });
    const response = await ask(followUp, THREAD);
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: "Paid budget spent" });
    expect(paidSpendBudgetRefusal).toHaveBeenCalledOnce();
    expect(deniedFetch).not.toHaveBeenCalled();
    expect(palChatRecordQuery(followUp, context.prior.turns)).toBeNull();
  });

  it("rejects an extra action carried into a refined follow-up", () => {
    expect(palChatRecordQuery("please", [{ role: "user", content: "Wine prices at Fox and Anchor. Book a table." }])).toBeNull();
  });

  it.each(UNKNOWN_ADDITIONAL_ACTIONS)("keeps an extra action carried into a refined owned follow-up on the configured HTTP provider path: %s", async (query) => {
    await registerPubPalToolTurn(THREAD, { query, cityId: "london", ownerId: OWNER, turns: [] });
    const context = await preparePalElevenLabsChatTurn({ query: "please", ownerId: OWNER, threadId: THREAD });
    const response = await ask("please", THREAD);
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: "Paid budget spent" });
    expect(paidSpendBudgetRefusal).toHaveBeenCalledOnce();
    expect(deniedFetch).not.toHaveBeenCalled();
    expect(palChatRecordQuery("please", context.prior.turns)).toBeNull();
  });

  it.each(["Wine prices at Fox and Anchor", "Cheapest wine in Soho"])("keeps a comparison without an extra action local in the public predicate: %s", (query) => {
    expect(palChatRecordQuery(query)).toBe(query);
  });

  it("keeps a source presentation clause local over configured HTTP", async () => {
    const query = "Plan a crawl in Soho for four of us, then show me the sources";
    expect(palChatRecordQuery(query)).toBe(query);
    const response = await ask(query);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ toolsUsed: ["propose_plan"] });
    expect(paidSpendBudgetRefusal).not.toHaveBeenCalled();
    expect(deniedFetch).not.toHaveBeenCalled();
  });
});

const PERSONAL_MEMORY_OPERATIONS = [
  "Find four pubs in Soho. Save my preference for gardens.",
  "Plan a crawl in Soho. Save my preferences: gardens and quiet rooms.",
  "Cheap pints near Soho. Store a note: I like gardens.",
  "Cheapest wine in Soho. Update my notes: I prefer gardens.",
  "Update my preferences: I like wine. Wine prices at Fox and Anchor",
];

const ASKS_WITHOUT_MEMORY_OPERATION = [
  ["Find four pubs in Soho to save money", "search_venues"],
  ["Plan a crawl in Soho with gardens", "propose_plan"],
] as const;

const GENERIC_PERSONALISATION = [
  "Find four pubs in Soho that suit my preferences",
  "Find four pubs in Soho that match my notes",
  "Plan a crawl in Soho that suits my preference for gardens",
];

describe("explicit personal preference and note operations beside local record answers", () => {
  it.each(PERSONAL_MEMORY_OPERATIONS)("rejects a direct personal memory operation in the public predicate: %s", (query) => {
    expect(palChatRecordQuery(query)).toBeNull();
  });

  it.each(PERSONAL_MEMORY_OPERATIONS)("rejects an owned follow-up personal memory operation in the public predicate: %s", async (query) => {
    const followUp = query.replace(" in Soho", " in the same area");
    await registerPubPalToolTurn(THREAD, { query: SOHO, cityId: "london", ownerId: OWNER, turns: [] });
    const context = await preparePalElevenLabsChatTurn({ query: followUp, ownerId: OWNER, threadId: THREAD });
    expect(palChatRecordQuery(followUp, context.prior.turns)).toBeNull();
  });

  it.each(PERSONAL_MEMORY_OPERATIONS)("keeps a direct personal memory operation on the configured HTTP provider path: %s", async (query) => {
    const response = await ask(query);
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: "Paid budget spent" });
    expect(paidSpendBudgetRefusal).toHaveBeenCalledOnce();
    expect(deniedFetch).not.toHaveBeenCalled();
  });

  it.each(PERSONAL_MEMORY_OPERATIONS)("keeps an owned follow-up personal memory operation on the configured HTTP provider path: %s", async (query) => {
    const followUp = query.replace(" in Soho", " in the same area");
    await registerPubPalToolTurn(THREAD, { query: SOHO, cityId: "london", ownerId: OWNER, turns: [] });
    const response = await ask(followUp, THREAD);
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: "Paid budget spent" });
    expect(paidSpendBudgetRefusal).toHaveBeenCalledOnce();
    expect(deniedFetch).not.toHaveBeenCalled();
  });

  it.each(ASKS_WITHOUT_MEMORY_OPERATION)("keeps an ask without a memory operation local in the public predicate: %s", (query) => {
    expect(palChatRecordQuery(query)).toBe(query);
  });

  it("rejects a memory operation carried into a refined follow-up in the public predicate", () => {
    expect(palChatRecordQuery("please", [{ role: "user", content: "Remember that I like wine. Wine prices at Fox and Anchor" }])).toBeNull();
  });

  it.each(ASKS_WITHOUT_MEMORY_OPERATION)("answers an ask without a memory operation locally over configured HTTP: %s", async (query, tool) => {
    const response = await ask(query);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ toolsUsed: [tool] });
    expect(paidSpendBudgetRefusal).not.toHaveBeenCalled();
    expect(deniedFetch).not.toHaveBeenCalled();
  });
});

describe("generic personalisation no local tool implements", () => {
  it.each(GENERIC_PERSONALISATION)("rejects the direct ask in the public predicate: %s", (query) => {
    expect(palChatRecordQuery(query)).toBeNull();
  });

  it.each(GENERIC_PERSONALISATION)("keeps the direct ask on the configured HTTP provider path: %s", async (query) => {
    const response = await ask(query);
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: "Paid budget spent" });
    expect(paidSpendBudgetRefusal).toHaveBeenCalledOnce();
    expect(deniedFetch).not.toHaveBeenCalled();
  });

  it.each(GENERIC_PERSONALISATION)("keeps an owned same-area ask on the configured HTTP provider path: %s", async (query) => {
    const followUp = query.replace(" in Soho", " in the same area");
    await registerPubPalToolTurn(THREAD, { query: SOHO, cityId: "london", ownerId: OWNER, turns: [] });
    const response = await ask(followUp, THREAD);
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: "Paid budget spent" });
    expect(paidSpendBudgetRefusal).toHaveBeenCalledOnce();
    expect(deniedFetch).not.toHaveBeenCalled();
  });
});

const UNRESOLVED_LOCAL_CAPABILITIES = [
  "Find three pubs followed by a dozen in Soho",
  "Find 3 pubs followed by a dozen in Soho",
  "Plan a crawl of three pubs followed by a dozen in Soho",
  "Find three pubs followed by a dozen in Soho under £6 a pint",
  "Cheap pints in three pubs followed by a dozen in Soho",
  "Find three pubs followed by a dozen in Soho, not in Camden",
  "Find three pubs followed by a dozen not in Camden but in Soho",
  "Find four pubs in Soho with vegan food",
  "Find four vegan pubs in Soho",
  "Find four vegetarian pubs in Soho",
  "Find four gluten-free pubs in Soho",
  "Find four halal pubs in Soho",
  "Find four pubs in Soho with halal food",
  "Find four pubs in Soho with vegetarian options",
  "Find four pubs in Soho, not in Camden with vegan food",
  "Find four pubs in Soho, not in Camden followed by a dozen",
  "Find four pubs in Soho, not in Camden Town with halal food",
  "Find four pubs not in Camden but in Soho with vegetarian options",
  "Find four halal quiet pubs in Soho",
  "Find four quiet halal pubs in Soho",
  "Find four low calorie pubs in Soho",
  "Find four pubs in Soho with low calorie food",
  "Find four burger pubs in Soho",
  "Find four pubs in Soho with pizza",
  "Find four pubs in Soho with sandwiches",
  "Find four pubs in Soho, not in Camden with low calorie food",
  "Find four pubs not in Camden but in Soho with burgers",
  "Find four quiet low calorie pubs in Soho, not in Camden Town",
];

describe("venue, item and status clause boundaries beside local record answers", () => {
  it.each(["wine prices at fox and anchor", "Wine prices at the Lamb"])("keeps a named recorded-drinks ask local regardless of capitalisation: %s", (query) => {
    expect(palChatRecordQuery(query)).toBe(query);
  });

  it.each([
    "wine prices at fox and anchor and contact alice",
    "Cheapest wine in Soho, book us a table",
    "How much is a burger in Camden? Are there Tube delays and book a table",
  ])("keeps an extra action outside the venue, item and status clauses on the provider path: %s", (query) => {
    expect(palChatRecordQuery(query)).toBeNull();
  });

  it.each(UNRESOLVED_LOCAL_CAPABILITIES)("keeps a direct unresolved quantity or dietary request on the configured HTTP provider path: %s", async (query) => {
    const response = await ask(query);
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: "Paid budget spent" });
    expect(paidSpendBudgetRefusal).toHaveBeenCalledOnce();
    expect(deniedFetch).not.toHaveBeenCalled();
    expect(palChatRecordQuery(query)).toBeNull();
  });

  it.each(UNRESOLVED_LOCAL_CAPABILITIES)("keeps an owned same-area unresolved quantity or dietary request on the configured HTTP provider path: %s", async (query) => {
    const followUp = query.replace(/ (?:in|near) Soho/, " in the same area");
    await registerPubPalToolTurn(THREAD, { query: SOHO, cityId: "london", ownerId: OWNER, turns: [] });
    const context = await preparePalElevenLabsChatTurn({ query: followUp, ownerId: OWNER, threadId: THREAD });
    const response = await ask(followUp, THREAD);
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: "Paid budget spent" });
    expect(paidSpendBudgetRefusal).toHaveBeenCalledOnce();
    expect(deniedFetch).not.toHaveBeenCalled();
    expect(palChatRecordQuery(followUp, context.prior.turns)).toBeNull();
  });

  it.each(UNRESOLVED_LOCAL_CAPABILITIES)("keeps a refined owned follow-up of an unresolved quantity or dietary request on the configured HTTP provider path: %s", async (query) => {
    await registerPubPalToolTurn(THREAD, { query, cityId: "london", ownerId: OWNER, turns: [] });
    const context = await preparePalElevenLabsChatTurn({ query: "please", ownerId: OWNER, threadId: THREAD });
    const response = await ask("please", THREAD);
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: "Paid budget spent" });
    expect(paidSpendBudgetRefusal).toHaveBeenCalledOnce();
    expect(deniedFetch).not.toHaveBeenCalled();
    expect(palChatRecordQuery("please", context.prior.turns)).toBeNull();
  });
});

const UNDETERMINED_MEMORY_OPERATIONS = [
  "Find four pubs in Soho. Save preferences for quiet gardens.",
  "Plan a crawl in Soho. Store notes: I prefer gardens.",
  "Cheap pints near Soho. Record preferences: quiet rooms.",
  "Cheapest wine in Soho. Save preferences for quiet gardens.",
  "Store notes: I like wine. Wine prices at Fox and Anchor",
];

describe("memory operations named without a determiner beside local record answers", () => {
  it.each(UNDETERMINED_MEMORY_OPERATIONS)("rejects a direct memory operation in the public predicate: %s", (query) => {
    expect(palChatRecordQuery(query)).toBeNull();
  });

  it.each(UNDETERMINED_MEMORY_OPERATIONS)("keeps a direct memory operation on the configured HTTP provider path: %s", async (query) => {
    const response = await ask(query);
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: "Paid budget spent" });
    expect(paidSpendBudgetRefusal).toHaveBeenCalledOnce();
    expect(deniedFetch).not.toHaveBeenCalled();
  });

  it.each(UNDETERMINED_MEMORY_OPERATIONS)("keeps an owned follow-up memory operation on the provider path: %s", async (query) => {
    const followUp = query.replace(" in Soho", " in the same area");
    await registerPubPalToolTurn(THREAD, { query: SOHO, cityId: "london", ownerId: OWNER, turns: [] });
    const context = await preparePalElevenLabsChatTurn({ query: followUp, ownerId: OWNER, threadId: THREAD });
    expect(palChatRecordQuery(followUp, context.prior.turns)).toBeNull();
    const response = await ask(followUp, THREAD);
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: "Paid budget spent" });
    expect(paidSpendBudgetRefusal).toHaveBeenCalledOnce();
    expect(deniedFetch).not.toHaveBeenCalled();
  });

  it("rejects a determiner-free memory operation carried into a refined follow-up", () => {
    expect(palChatRecordQuery("please", [{ role: "user", content: "Store notes: I like wine. Wine prices at Fox and Anchor" }])).toBeNull();
  });

  it.each([
    ["Find four pubs in Soho with quiet gardens", "search_venues"],
    ["Plan a crawl in Soho to save money", "propose_plan"],
  ] as const)("keeps an ordinary ask without a memory operation local over configured HTTP: %s", async (query, tool) => {
    expect(palChatRecordQuery(query)).toBe(query);
    const response = await ask(query);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ toolsUsed: [tool] });
    expect(paidSpendBudgetRefusal).not.toHaveBeenCalled();
    expect(deniedFetch).not.toHaveBeenCalled();
  });
});
