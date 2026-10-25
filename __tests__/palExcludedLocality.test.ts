import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({
  clientIp: () => "203.0.113.82",
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
import { refineRoutedAskQuery, refineVenueAreaFollowUp, routeAskDeterministically } from "@/lib/ask/router";
import { runAsk } from "@/lib/ask/runAsk";
import { areaCandidatesInText, areaVerbatimInText, defaultKnownAreas, validateJudgedIntent } from "@/lib/concierge/intentPolicy";
import { loadConciergeVenues } from "@/lib/concierge/venues.server";
import type { ConciergeVenue } from "@/lib/concierge/rank";
import { palChatRecordQuery, preparePalElevenLabsChatTurn } from "@/lib/palElevenLabsChat.server";
import { paidSpendBudgetRefusal } from "@/lib/paidSpendBudget.server";
import { __resetPintDrops } from "@/lib/pintDrops";
import { invokePubPalAskTool, resolvePubPalToolQuery } from "@/lib/pubPalToolInvoke.server";
import { windowPalSessionTurns } from "@/lib/palSessionSummary";
import { __resetPubPalToolTurnStore, registerPubPalToolTurn } from "@/lib/pubPalToolTurnStore";

const OWNER = "11111111-1111-4111-8111-111111111111";
const THREAD = "conv_excludedlocality01";
const deniedFetch = vi.fn(async () => { throw new Error("External services are denied"); });

function listedPub(id: string, name: string, area: string, lat: number, lng: number): ConciergeVenue {
  return {
    id, name, searchText: `${name} ${area}`, area, lat, lng,
    cheapestPrice: 5.5, priceSource: "https://example.com/menu", priceObservedAt: "2026-10-21",
    amenities: { beerGarden: true, food: true, cocktails: false, liveSports: false, liveMusic: false },
    nearWater: false, hasStory: false, canonical: true,
  };
}

const VENUES = [
  listedPub("soho-one", "Dean Street Arms", "Soho", 51.5136, -0.1318),
  listedPub("soho-two", "Greek Street Tavern", "Soho", 51.513, -0.1335),
  listedPub("soho-three", "Frith Street Vaults", "Soho", 51.5142, -0.135),
  listedPub("soho-four", "Old Compton Inn", "Soho", 51.5125, -0.1325),
  listedPub("camden-one", "Parkway Arms", "Camden", 51.539, -0.1426),
  listedPub("camden-two", "Chalk Farm Tavern", "Camden", 51.541, -0.144),
  listedPub("camden-three", "Lock Side Vaults", "Camden", 51.5375, -0.141),
  listedPub("camden-four", "Jamestown Inn", "Camden", 51.5402, -0.1455),
];

const POSITIVE = [
  { query: "Find four pubs not in Camden but in Soho", area: "Soho", wanted: "soho-", tool: "search_venues", count: 4, followUp: "Find four pubs in the same area" },
  { query: "Find four pubs in Camden, not in Soho", area: "Camden", wanted: "camden-", tool: "search_venues", count: 4, followUp: "Find four pubs in the same area" },
  { query: "Plan a pub crawl not in Camden but in Soho", area: "Soho", wanted: "soho-", tool: "propose_plan", count: 3, followUp: "Plan a pub crawl in the same area" },
  { query: "Plan a pub crawl in Camden, not in Soho", area: "Camden", wanted: "camden-", tool: "propose_plan", count: 3, followUp: "Plan a pub crawl in the same area" },
];

type Answer = {
  toolsUsed: string[];
  cards: Array<{ venueId: string }>;
  proposals: Array<{ kind: string; query?: string }>;
};

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

describe("the positive requested area drives execution, never the excluded one", () => {
  it.each(POSITIVE)("answers $query from $area records over HTTP", async ({ query, wanted, tool, count }) => {
    expect(palChatRecordQuery(query)).toBe(query);
    const response = await ask(query);
    expect(response.status).toBe(200);
    const body = await response.json() as Answer;
    expect(body.toolsUsed).toEqual([tool]);
    expect(body.cards).toHaveLength(count);
    expect(body.cards.every((card) => card.venueId.startsWith(wanted))).toBe(true);
    if (tool === "propose_plan") {
      expect(body.proposals.find((proposal) => proposal.kind === "draft_plan")?.query).toBe(query);
    }
    expect(paidSpendBudgetRefusal).not.toHaveBeenCalled();
    expect(deniedFetch).not.toHaveBeenCalled();
  });

  it.each(POSITIVE)("carries $area through an owned same-area follow-up to $query", async ({ query, area, wanted, count, followUp }) => {
    await registerPubPalToolTurn(THREAD, { query, cityId: "london", ownerId: OWNER, turns: [] });
    const context = await preparePalElevenLabsChatTurn({ query: followUp, ownerId: OWNER, threadId: THREAD });
    expect(palChatRecordQuery(followUp, context.prior.turns)).toBe(followUp.replace("in the same area", `in ${area}`));
    const response = await ask(followUp, THREAD);
    expect(response.status).toBe(200);
    const body = await response.json() as Answer;
    expect(body.cards).toHaveLength(count);
    expect(body.cards.every((card) => card.venueId.startsWith(wanted))).toBe(true);
    expect(paidSpendBudgetRefusal).not.toHaveBeenCalled();
    expect(deniedFetch).not.toHaveBeenCalled();
  });

  it.each(POSITIVE)("hands the $area records to the public tool consumer for $query", async ({ query, wanted, tool, count, followUp }) => {
    await registerPubPalToolTurn(THREAD, { query, cityId: "london", ownerId: OWNER, turns: [] });
    const direct = await invokePubPalAskTool({ toolName: tool, args: {}, conversationId: THREAD });
    const directCards = direct.result.cards as Array<{ venueId: string }>;
    expect(direct.result.tool).toBe(tool);
    expect(directCards).toHaveLength(count);
    expect(directCards.every((card) => card.venueId.startsWith(wanted))).toBe(true);

    __resetPubPalToolTurnStore();
    await registerPubPalToolTurn(THREAD, { query: followUp, cityId: "london", ownerId: OWNER, turns: [{ role: "user", content: query }] });
    const followed = await invokePubPalAskTool({ toolName: tool, args: {}, conversationId: THREAD });
    const followedCards = followed.result.cards as Array<{ venueId: string }>;
    expect(followedCards).toHaveLength(count);
    expect(followedCards.every((card) => card.venueId.startsWith(wanted))).toBe(true);
    expect(deniedFetch).not.toHaveBeenCalled();
  });

  it.each(["Find four pubs not in Soho but in Oxford", "Find four pubs not in Soho"])(
    "keeps an unsupported or missing positive area on the provider path: %s", async (query) => {
      expect(palChatRecordQuery(query)).toBeNull();
      const response = await ask(query);
      expect(response.status).toBe(429);
      expect(await response.json()).toEqual({ error: "Paid budget spent" });
      expect(paidSpendBudgetRefusal).toHaveBeenCalledOnce();
      expect(deniedFetch).not.toHaveBeenCalled();
    },
  );
});

const PINT_ASKS = [
  { query: "Cheapest pint in Soho, not in Camden", area: "Soho", excluded: "camden-" },
  { query: "Cheapest pint not in Camden but in Soho", area: "Soho", excluded: "camden-" },
  { query: "Cheapest pint in Camden, not in Soho", area: "Camden", excluded: "soho-" },
  { query: "Cheapest pint not in Soho but in Camden", area: "Camden", excluded: "soho-" },
];

describe("sibling tools read only the positive area", () => {
  it.each(PINT_ASKS)("routes $query to cheapest pints in $area and answers it locally over HTTP", async ({ query, area, excluded }) => {
    expect(routeAskDeterministically(query)).toEqual([{ name: "cheapest_pint_near", args: { area } }]);
    expect(palChatRecordQuery(query)).toBe(query);
    const response = await ask(query);
    expect(response.status).toBe(200);
    const body = await response.json() as Answer;
    expect(body.toolsUsed).toEqual(["cheapest_pint_near"]);
    expect(body.cards.every((card) => !card.venueId.startsWith(excluded))).toBe(true);
    expect(paidSpendBudgetRefusal).not.toHaveBeenCalled();
    expect(deniedFetch).not.toHaveBeenCalled();
  });

  it.each([
    ["Wifi to work from in Soho, not in Camden", "find_desk", "Soho", "Camden"],
    ["Wifi to work from not in Soho but in Camden", "find_desk", "Camden", "Soho"],
    ["How busy is it in Soho, not in Camden", "tonight_now", "Soho", "Camden"],
    ["How busy is it not in Soho but in Camden", "tonight_now", "Camden", "Soho"],
    ["What's the buzz in Soho, not in Camden", "area_buzz", "Soho", "Camden"],
    ["What's the buzz not in Soho but in Camden", "area_buzz", "Camden", "Soho"],
  ] as const)("routes %s to %s in %s only", (query, name, area, excluded) => {
    const calls = routeAskDeterministically(query);
    expect(calls).toContainEqual({ name, args: { area } });
    expect(calls).not.toContainEqual({ name, args: { area: excluded } });
  });

  it("offers and accepts only the positive area from a model judgment", () => {
    const known = defaultKnownAreas();
    for (const [query, area, excluded] of [
      ["Find four pubs in Soho, not in Camden", "Soho", "Camden"],
      ["Find four pubs not in Soho but in Camden", "Camden", "Soho"],
    ] as const) {
      const candidates = areaCandidatesInText(query, known);
      expect(candidates).toContain(area);
      expect(candidates).not.toContain(excluded);
      expect(areaVerbatimInText(query, area)).toBe(true);
      expect(areaVerbatimInText(query, excluded)).toBe(false);
      expect(validateJudgedIntent({ mood: [], groupSize: 2, area }, query)).toEqual({ mood: [], groupSize: 2, area });
      expect(validateJudgedIntent({ mood: [], groupSize: 2, area: excluded }, query)).toBeNull();
    }
  });
});

const SOHO_ASK = "Find four pubs in Soho";
const SAME_AREA_ASK = "Find four pubs in the same area";
const EXCLUDED_REFERENCES = [
  "Find four pubs in the same area, not in Soho",
  "Find four pubs around the same patch, not in Soho",
  "Find four pubs in the same neighbourhood, but not in Soho",
  "Plan a pub crawl in the same area, not in Soho",
  "Find four pubs in the same area, not in Soho. Soho is too busy.",
  "Find four pubs around the same patch, not in Soho. Soho is too busy.",
  "Find four pubs in the same neighbourhood, but not in Soho. Soho is too busy.",
  "Plan a pub crawl in the same area, not in Soho. Soho is too busy.",
];

describe("an inferred area never becomes the place the ask excludes", () => {
  it.each(EXCLUDED_REFERENCES)("keeps %s unresolved through follow-up, session and tool query resolution", (query) => {
    expect(refineVenueAreaFollowUp(query, [SOHO_ASK])).toBeNull();
    expect(refineVenueAreaFollowUp(query, ["Find four pubs in Camden", SOHO_ASK])).toBeNull();
    expect(refineRoutedAskQuery(query, SOHO_ASK, [SOHO_ASK])).toBe(query);
    expect(refineVenueAreaFollowUp(SAME_AREA_ASK, [SOHO_ASK, query])).toBeNull();
    const session = windowPalSessionTurns("", [
      { role: "user", content: SOHO_ASK }, { role: "user", content: query }, { role: "user", content: SAME_AREA_ASK },
    ]);
    expect(session.turns.map((turn) => turn.content)).toEqual([SOHO_ASK, query, SAME_AREA_ASK]);
    expect(resolvePubPalToolQuery({ turnQuery: query, args: {}, turns: session.turns.slice(0, 1) })).toBe(query);
    expect(palChatRecordQuery(query, [{ role: "user", content: SOHO_ASK }])).toBeNull();
  });

  it("keeps positive locality, a different exclusion and an ordinary short follow-up", () => {
    expect(refineRoutedAskQuery("Pubs not in Soho", SOHO_ASK, [SOHO_ASK])).toBe("Pubs not in Soho");
    expect(refineRoutedAskQuery("Four quiet pubs", SOHO_ASK, [SOHO_ASK])).toBe("Four quiet pubs in Soho");
    expect(refineVenueAreaFollowUp("Find four pubs in the same area, not in Camden", [SOHO_ASK])).toBe("Find four pubs in Soho, not in Camden");
    expect(refineVenueAreaFollowUp("Find four pubs in the same area, not in Camden. Camden is too busy.", [SOHO_ASK])).toBe("Find four pubs in Soho, not in Camden. Camden is too busy.");
    expect(palChatRecordQuery("Find four pubs in the same area, not in Camden", [{ role: "user", content: SOHO_ASK }])).toBe("Find four pubs in Soho, not in Camden");
    expect(palChatRecordQuery("Find four pubs in Camden, not in Soho", [{ role: "user", content: SOHO_ASK }])).toBe("Find four pubs in Camden, not in Soho");
  });

  it.each(EXCLUDED_REFERENCES)("sends %s after owned Soho history to the provider path over HTTP", async (query) => {
    await registerPubPalToolTurn(THREAD, { query: SOHO_ASK, cityId: "london", ownerId: OWNER, turns: [] });
    const context = await preparePalElevenLabsChatTurn({ query, ownerId: OWNER, threadId: THREAD });
    expect(palChatRecordQuery(query, context.prior.turns)).toBeNull();
    const response = await ask(query, THREAD);
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: "Paid budget spent" });
    expect(paidSpendBudgetRefusal).toHaveBeenCalledOnce();
    expect(deniedFetch).not.toHaveBeenCalled();
  });

  it("still answers a different exclusion from owned Soho records over HTTP", async () => {
    await registerPubPalToolTurn(THREAD, { query: SOHO_ASK, cityId: "london", ownerId: OWNER, turns: [] });
    const response = await ask("Find four pubs in the same area, not in Camden", THREAD);
    expect(response.status).toBe(200);
    const body = await response.json() as Answer;
    expect(body.cards).toHaveLength(4);
    expect(body.cards.every((card) => card.venueId.startsWith("soho-"))).toBe(true);
    expect(paidSpendBudgetRefusal).not.toHaveBeenCalled();
    expect(deniedFetch).not.toHaveBeenCalled();
  });

  it("does not infer or label the excluded place in owned tool execution or runAsk", async () => {
    const query = EXCLUDED_REFERENCES[0]!;
    await registerPubPalToolTurn(THREAD, { query, cityId: "london", ownerId: OWNER, turns: [{ role: "user", content: SOHO_ASK }] });
    const { result } = await invokePubPalAskTool({ toolName: "search_venues", args: {}, conversationId: THREAD });
    const toolCards = result.cards as Array<{ venueId: string; title: string; note: string }>;
    expect(toolCards.filter((card) => card.venueId.startsWith("soho-"))).toEqual([]);
    expect(toolCards.map((card) => `${card.title} ${card.note}`).join(" ")).not.toMatch(/soho/i);
    const answer = await runAsk({ query, cityId: "london", skipModel: true, turns: [{ role: "user", content: SOHO_ASK }] });
    expect(answer.cards.filter((card) => String(card.venueId ?? "").startsWith("soho-"))).toEqual([]);
    expect(deniedFetch).not.toHaveBeenCalled();
  });
});
