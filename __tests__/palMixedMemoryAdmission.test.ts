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
  ] as const)("keeps an ordinary records request local: %s", async (query, tool) => {
    expect(palChatRecordQuery(query)).toBe(query);
    const response = await ask(query);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ toolsUsed: [tool] });
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
  ["Find four pubs in Soho that suit my preferences", "search_venues"],
  ["Find four pubs in Soho that match my notes", "search_venues"],
  ["Plan a crawl in Soho that suits my preference for gardens", "propose_plan"],
] as const;

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
