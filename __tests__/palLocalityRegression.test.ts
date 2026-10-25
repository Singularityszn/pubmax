import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({
  clientIp: () => "203.0.113.81",
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
import { refineRoutedAskQuery, refineVenueAreaFollowUp, resolveAskLocality, routeAskDeterministically } from "@/lib/ask/router";
import { runAskTool } from "@/lib/ask/tools";
import { requestedVenueQuantity } from "@/lib/concierge/intentPolicy";
import { loadConciergeVenues } from "@/lib/concierge/venues.server";
import type { ConciergeVenue } from "@/lib/concierge/rank";
import { palChatRecordQuery, preparePalElevenLabsChatTurn } from "@/lib/palElevenLabsChat.server";
import { windowPalSessionTurns } from "@/lib/palSessionSummary";
import { paidSpendBudgetRefusal } from "@/lib/paidSpendBudget.server";
import { __resetPintDrops } from "@/lib/pintDrops";
import { resolvePubPalToolQuery } from "@/lib/pubPalToolInvoke.server";
import { __resetPubPalToolTurnStore, registerPubPalToolTurn } from "@/lib/pubPalToolTurnStore";

const OWNER = "11111111-1111-4111-8111-111111111111";
const THREAD = "conv_localityregression01";
const SOHO = "Find four pubs in Soho";
const OXFORD = "Find four pubs in Oxford";
const deniedFetch = vi.fn(async () => { throw new Error("External services are denied"); });

function listedPub(id: string, name: string, searchText = name): ConciergeVenue {
  return {
    id, name, searchText, area: "Westminster", lat: 51.514, lng: -0.134,
    cheapestPrice: 5.5, priceSource: "https://example.com/menu", priceObservedAt: "2026-10-21",
    amenities: { beerGarden: true, food: true, cocktails: false, liveSports: false, liveMusic: false },
    nearWater: false, hasStory: false, canonical: true,
  };
}

const VENUES = [
  listedPub("oxford-arms", "Oxford Arms"),
  listedPub("flying-horse", "Flying Horse", "Flying Horse Oxford Street London"),
  listedPub("soho-one", "Soho One"),
  listedPub("soho-two", "Soho Two"),
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

describe("supported locality at the local answer boundary", () => {
  it.each(["Find four pubs in Oxford", "A pub crawl in Oxford", "Pints under £6.50 in Oxford"])(
    "keeps unsupported explicit locality on the provider path: %s", (query) => {
      expect(palChatRecordQuery(query)).toBeNull();
      expect(palChatRecordQuery(query, [{ role: "user", content: SOHO }])).toBeNull();
    },
  );

  it.each(["Four quiet pubs", "Find four pubs in the same area", "Pints under £6.50 in the same area"])(
    "does not borrow Soho past the newest unsupported owned place: %s", async (query) => {
      await registerPubPalToolTurn(THREAD, {
        query: OXFORD, cityId: "london", ownerId: OWNER, turns: [{ role: "user", content: SOHO }],
      });
      const context = await preparePalElevenLabsChatTurn({ query, ownerId: OWNER, threadId: THREAD });
      expect(context.prior.turns.map((turn) => turn.content)).toEqual([SOHO, OXFORD]);
      expect(palChatRecordQuery(query, context.prior.turns)).toBeNull();
      expect(deniedFetch).not.toHaveBeenCalled();
    },
  );

  it("preserves an unsupported place through normalization and the tool query boundary", () => {
    const session = windowPalSessionTurns("", [
      { role: "user", content: SOHO }, { role: "user", content: OXFORD },
      { role: "user", content: "Find four pubs in the same area" },
    ]);
    const query = resolvePubPalToolQuery({
      turnQuery: "Find four pubs in the same area", args: {}, turns: session.turns,
    });
    expect(query).toContain("Oxford");
    expect(query).not.toContain("Soho");
    expect(palChatRecordQuery(query)).toBeNull();
    expect(refineRoutedAskQuery("in Oxford", SOHO)).toBe("in Oxford");
  });

  it.each(["Find four pubs in Soho, please", "Four pubs in Soho with food and a garden"])(
    "keeps valid qualifiers on direct and owned follow-up paths: %s", async (query) => {
      expect(palChatRecordQuery(query)).toBe(query);
      expect(refineVenueAreaFollowUp("Find four pubs in the same area", [query])).toBe(SOHO);
      expect(palChatRecordQuery("Four quiet pubs", [{ role: "user", content: query }])).toBe("Four quiet pubs in Soho");
      const response = await ask(query);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ status: "ready", toolsUsed: ["search_venues"] });
      expect(paidSpendBudgetRefusal).not.toHaveBeenCalled();
      expect(deniedFetch).not.toHaveBeenCalled();
    },
  );

  it.each(["Find four pubs in Soho or Camden", "Find four pubs"])(
    "preserves provider routing for ambiguous or missing locality: %s", async (query) => {
      expect(palChatRecordQuery(query)).toBeNull();
      expect(palChatRecordQuery("Four quiet pubs", [{ role: "user", content: query }])).toBeNull();
      expect(palChatRecordQuery("Find four pubs in the same area", [{ role: "user", content: query }])).toBeNull();
      expect((await ask(query)).status).toBe(429);
      expect(paidSpendBudgetRefusal).toHaveBeenCalledOnce();
      expect(deniedFetch).not.toHaveBeenCalled();
    },
  );
});

const UNCONSUMED_ADDITIVE_QUANTITIES = [
  "Find three pubs in Soho followed by a dozen",
  "Find three pubs in Soho, then a handful",
  "Find three pubs in Soho plus several",
  "Find three pubs in Soho with food and several",
  "Find three pubs plus several in Soho",
  "Find three pubs and a bar in Soho",
  "Find three pubs in Soho for four of us plus several",
  "Find three pubs in Soho under £6.50 a pint followed by several",
  "Pints under £6.50 in Soho across three pubs and several",
  "Plan a crawl in Soho at 8 pm with three pubs then a score",
  "Plan a pub crawl in Soho followed by a dozen",
  "A pub crawl in Soho for three plus several",
  "Plan a crawl in Soho with several stops",
  "Find three pubs in Soho followed by a heap",
  "Find three pubs with food and a gaggle in Soho",
];

describe("unconsumed additive quantities before or after the area, party, price and time", () => {
  it.each(UNCONSUMED_ADDITIVE_QUANTITIES)("keeps a direct request on the configured HTTP provider path: %s", async (query) => {
    expect(palChatRecordQuery(query)).toBeNull();
    const response = await ask(query);
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: "Paid budget spent" });
    expect(paidSpendBudgetRefusal).toHaveBeenCalledOnce();
    expect(deniedFetch).not.toHaveBeenCalled();
  });

  it.each(UNCONSUMED_ADDITIVE_QUANTITIES)("keeps an owned same-area request on the configured HTTP provider path: %s", async (query) => {
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

  it.each(["Three pubs plus several", "Three pubs, then several"])("rejects a short follow-up refined into the owned area: %s", (query) => {
    expect(refineRoutedAskQuery(query, SOHO)).toBe(`${query} in Soho`);
    expect(palChatRecordQuery(query, [{ role: "user", content: SOHO }])).toBeNull();
  });

  it.each(["Find three pubs in Soho followed by a dozen", "Find three pubs plus several in Soho", "Find three pubs in Soho followed by a heap", "Find three pubs with food and a gaggle in Soho"])(
    "leaves the shared quantity unresolved so the router keeps its default count: %s", (query) => {
      expect(requestedVenueQuantity(query)).toBeNull();
      expect(routeAskDeterministically(query)).toEqual([{ name: "search_venues", args: { query, limit: 4 } }]);
    },
  );

  it.each([
    ["Find three pubs in Soho for a quick one after work", "search_venues", 3],
    ["Find three pubs near Soho, not pricey", "search_venues", 3],
    ["Plan a crawl in Soho for 6 people at 8 pm", "propose_plan", undefined],
  ] as const)("keeps a complete request local through the same seams: %s", async (query, tool, count) => {
    expect(requestedVenueQuantity(query)).toBe(count);
    expect(palChatRecordQuery(query)).toBe(query);
    const response = await ask(query);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ toolsUsed: [tool] });
    expect(paidSpendBudgetRefusal).not.toHaveBeenCalled();
    expect(deniedFetch).not.toHaveBeenCalled();
  });
});

const OXFORD_NOT_SOHO = "Find four pubs in Oxford, not in Soho";
const SOHO_NOT_OXFORD = "Find four pubs in Soho, not in Oxford";

describe("positive locality over an excluded place", () => {
  it("resolves the positive place at the public locality boundary", () => {
    expect(resolveAskLocality(OXFORD_NOT_SOHO)).toEqual({ kind: "unsupported", area: "Oxford" });
    expect(resolveAskLocality(SOHO_NOT_OXFORD)).toEqual({ kind: "supported", area: "Soho" });
    expect(resolveAskLocality("Find four pubs in Soho or Oxford")).toEqual({ kind: "ambiguous" });
    expect(resolveAskLocality("Find four pubs in Soho, Oxford, please")).toEqual({ kind: "ambiguous" });
    expect(resolveAskLocality("Four pubs in Soho with food and a garden")).toEqual({ kind: "supported", area: "Soho" });
    expect(resolveAskLocality("Find four pubs")).toEqual({ kind: "missing" });
  });

  it("keeps the positive unsupported place through local, history and tool query boundaries", () => {
    expect(palChatRecordQuery(OXFORD_NOT_SOHO)).toBeNull();
    expect(palChatRecordQuery(OXFORD_NOT_SOHO, [{ role: "user", content: SOHO }])).toBeNull();
    for (const followUp of ["Four quiet pubs", "Find four pubs in the same area", "Pints under £6.50 in the same area"]) {
      expect(palChatRecordQuery(followUp, [{ role: "user", content: OXFORD_NOT_SOHO }])).toBeNull();
    }
    expect(refineVenueAreaFollowUp("Find four pubs in the same area", [SOHO, OXFORD_NOT_SOHO])).toBe("Find four pubs in Oxford");
    const session = windowPalSessionTurns("", [
      { role: "user", content: SOHO }, { role: "user", content: OXFORD_NOT_SOHO },
    ]);
    const query = resolvePubPalToolQuery({ turnQuery: "Find four pubs in the same area", args: {}, turns: session.turns });
    expect(query).toBe("Find four pubs in Oxford");
    expect(palChatRecordQuery(query)).toBeNull();
  });

  it("keeps a supported positive Soho local when it excludes Oxford", () => {
    expect(palChatRecordQuery(SOHO_NOT_OXFORD)).toBe(SOHO_NOT_OXFORD);
    expect(palChatRecordQuery("Four quiet pubs", [{ role: "user", content: SOHO_NOT_OXFORD }])).toBe("Four quiet pubs in Soho");
    expect(refineVenueAreaFollowUp("Find four pubs in the same area", [SOHO_NOT_OXFORD])).toBe(SOHO);
  });

  it("does not borrow Soho through an owned Oxford-not-Soho turn", async () => {
    await registerPubPalToolTurn(THREAD, {
      query: OXFORD_NOT_SOHO, cityId: "london", ownerId: OWNER, turns: [{ role: "user", content: SOHO }],
    });
    const context = await preparePalElevenLabsChatTurn({ query: "Four quiet pubs", ownerId: OWNER, threadId: THREAD });
    expect(context.prior.turns.map((turn) => turn.content)).toEqual([SOHO, OXFORD_NOT_SOHO]);
    expect(palChatRecordQuery("Four quiet pubs", context.prior.turns)).toBeNull();
    const response = await ask("Find four pubs in the same area", THREAD);
    expect(response.status).toBe(429);
    expect(paidSpendBudgetRefusal).toHaveBeenCalledOnce();
    expect(deniedFetch).not.toHaveBeenCalled();
  });

  it.each([false, true])("answers Oxford-not-Soho on the provider path over HTTP, prior Soho=%s", async (priorSoho) => {
    let threadId: string | undefined;
    if (priorSoho) {
      const first = await ask(SOHO);
      expect(first.status).toBe(200);
      threadId = (await first.json()).conversationId;
      expect(threadId).toBeTruthy();
    }
    const response = await ask(OXFORD_NOT_SOHO, threadId);
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: "Paid budget spent" });
    expect(paidSpendBudgetRefusal).toHaveBeenCalledOnce();
    expect(deniedFetch).not.toHaveBeenCalled();
  });

  it("answers Soho-not-Oxford from local records over HTTP", async () => {
    const response = await ask(SOHO_NOT_OXFORD);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ toolsUsed: ["search_venues"] });
    expect(paidSpendBudgetRefusal).not.toHaveBeenCalled();
    expect(deniedFetch).not.toHaveBeenCalled();
  });
});

describe("configured HTTP locality with London name and address collisions", () => {
  it.each([false, true])("does not answer Oxford with London pub matches, prior Soho=%s", async (priorSoho) => {
    let threadId: string | undefined;
    if (priorSoho) {
      const first = await ask(SOHO);
      expect(first.status).toBe(200);
      const answer = await first.json();
      expect(answer.cards).toHaveLength(4);
      threadId = answer.conversationId;
      expect(threadId).toBeTruthy();
    }
    const response = await ask(OXFORD, threadId);
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: "Paid budget spent" });
    expect(paidSpendBudgetRefusal).toHaveBeenCalledOnce();
    expect(deniedFetch).not.toHaveBeenCalled();
  });

  it.each(["Four quiet pubs", "Find four pubs in the same area"])(
    "does not admit a local HTTP follow-up to owned Oxford: %s", async (query) => {
      await registerPubPalToolTurn(THREAD, {
        query: OXFORD, cityId: "london", ownerId: OWNER, turns: [{ role: "user", content: SOHO }],
      });
      const response = await ask(query, THREAD);
      expect(response.status).toBe(429);
      expect(paidSpendBudgetRefusal).toHaveBeenCalledOnce();
      expect(deniedFetch).not.toHaveBeenCalled();
    },
  );
});

describe("fixed three-stop plan admission", () => {
  it.each([
    "Plan a crawl in Soho with four stops",
    "Plan a 4-stop crawl in Soho",
    "Plan four pubs in a crawl in Soho",
    "Plan a crawl in Soho with two stops",
    "Plan a crawl in Soho with 100 stops",
    "Plan a crawl in Soho with eleven stops",
    "Plan a crawl in Soho with thirteen stops",
    "Plan a crawl in Soho with twenty-three stops",
    "Plan a crawl in Soho with twenty three stops",
    "Plan a crawl in Soho with one hundred and three stops",
    "Plan a crawl in Soho with 2.3 stops",
    "Plan a crawl in Soho with 2-3 stops",
    "Plan a crawl in Soho with zero stops",
    "Plan a crawl in Soho with four\nstops",
    "Plan a crawl in Soho with twenty\nthree stops",
    "Plan a crawl in Soho with 4\tstops",
    "Plan a crawl in Soho with four garden pubs",
    "Plan a crawl in Soho with four dog-friendly garden pubs",
    "Plan a crawl in Soho with four of the best pubs",
    "Plan a crawl in Soho with four really nice old riverside craft beer and cider pubs",
    "Plan a crawl in Soho with four\ngarden pubs",
    "Plan a crawl in Soho with 4 garden pubs",
    "Plan a crawl in Soho with twenty-three garden pubs",
    "Plan a crawl in Soho for four of us with two garden pubs",
    "Plan a crawl in Soho with 2/3 pubs",
    "Plan a crawl in Soho with 2 to 3 pubs",
    "Plan a crawl in Soho with two or three pubs",
    "Plan a crawl in Soho with three and a half pubs",
    "Plan a crawl in Soho with three-and-a-half garden pubs",
    "Plan a crawl in Soho with four exceptionally welcoming dog-friendly riverside garden pubs",
  ])("keeps an explicit non-three stop count on the provider path: %s", async (query) => {
    expect(palChatRecordQuery(query)).toBeNull();
    expect(palChatRecordQuery(query.replace(" in Soho", " in the same area"), [{ role: "user", content: SOHO }])).toBeNull();
    expect(palChatRecordQuery(`${query}. Are there Tube delays?`)).toBeNull();
    const response = await ask(query);
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: "Paid budget spent" });
    expect(paidSpendBudgetRefusal).toHaveBeenCalledOnce();
    expect(deniedFetch).not.toHaveBeenCalled();
  });

  it.each([
    "A three-stop pub crawl in Soho",
    "A pub crawl in Soho for three",
    "Plan a crawl in Soho for four of us",
    "Plan a crawl in Soho for four of us with three garden pubs",
    "Plan a three-stop crawl in Soho for 6 people",
    "Plan a crawl in Soho at 8 pm with three garden pubs",
    "Plan a crawl in Soho with three exceptionally welcoming dog-friendly riverside garden pubs",
    "Plan a crawl in Soho for 2 to 4 of us with three garden pubs",
  ])(
    "keeps the fixed three-stop plan local, with party size apart from stops: %s", async (query) => {
      expect(palChatRecordQuery(query)).toBe(query);
      const response = await ask(query);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ toolsUsed: ["propose_plan"] });
      expect(paidSpendBudgetRefusal).not.toHaveBeenCalled();
      expect(deniedFetch).not.toHaveBeenCalled();
    },
  );
});

describe("owned-history crawl counts against the fixed three-stop plan", () => {
  it.each([
    ["Plan a crawl in the same area with four garden pubs", false],
    ["Plan a crawl in the same area with four of the best pubs", false],
    ["Plan a crawl in the same area for four of us with two cosy pubs", false],
    ["Plan a crawl in the same area with 2/3 pubs", false],
    ["Plan a crawl in the same area with three and a half pubs", false],
    ["Plan a crawl in the same area with four exceptionally welcoming dog-friendly riverside garden pubs", false],
    ["Plan a crawl in the same area with three garden pubs", true],
    ["Plan a crawl in the same area for four of us", true],
  ] as const)("%s keeps the fixed three-stop plan=%s", async (query, fixedThree) => {
    await registerPubPalToolTurn(THREAD, { query: SOHO, cityId: "london", ownerId: OWNER, turns: [] });
    const context = await preparePalElevenLabsChatTurn({ query, ownerId: OWNER, threadId: THREAD });
    expect(palChatRecordQuery(query, context.prior.turns)).toBe(fixedThree ? query.replace("in the same area", "in Soho") : null);
    const response = await ask(query, THREAD);
    if (fixedThree) {
      expect(response.status).toBe(200);
      const body = await response.json() as {
        toolsUsed: string[];
        cards: Array<{ venueId: string }>;
        proposals: Array<{ kind: string; stopIds?: string[] }>;
      };
      expect(body.toolsUsed).toEqual(["propose_plan"]);
      expect(body.cards).toHaveLength(3);
      expect(body.proposals.find((proposal) => proposal.kind === "draft_plan")?.stopIds).toHaveLength(3);
      expect(paidSpendBudgetRefusal).not.toHaveBeenCalled();
    } else {
      expect(response.status).toBe(429);
      expect(await response.json()).toEqual({ error: "Paid budget spent" });
      expect(paidSpendBudgetRefusal).toHaveBeenCalledOnce();
    }
    expect(deniedFetch).not.toHaveBeenCalled();
  });
});

const ADDITIVE_QUANTITIES = [
  "Plan a crawl in Soho with three pubs then three more pubs",
  "Plan a crawl in Soho with 3 pubs and 3 more pubs",
  "Plan a crawl in Soho with three pubs plus three more bars",
  "Find three pubs then three more pubs in Soho",
  "Find 3 pubs plus 3 more bars in Soho",
  "Find three pubs and three more pubs in Soho under £6.50 a pint",
  "Plan a crawl in Soho with three pubs then three more",
  "Plan a crawl in Soho with 3 pubs and 3 more",
  "Find three pubs then three more in Soho",
  "Find 3 pubs plus 3 in Soho",
  "Find three pubs and another three in Soho under £6.50 a pint",
];

describe("additive venue quantities against local admission", () => {
  it.each(ADDITIVE_QUANTITIES)("keeps a direct additive quantity on the provider path: %s", async (query) => {
    expect(palChatRecordQuery(query)).toBeNull();
    const response = await ask(query);
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: "Paid budget spent" });
    expect(paidSpendBudgetRefusal).toHaveBeenCalledOnce();
    expect(deniedFetch).not.toHaveBeenCalled();
  });

  it.each(ADDITIVE_QUANTITIES)("keeps an owned same-area additive quantity on the provider path: %s", async (query) => {
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
    ["Find three pubs in Soho", "search_venues", 3],
    ["Plan a crawl in Soho with three pubs", "propose_plan", 3],
    ["A pub crawl in Soho for three, not pricey", "propose_plan", 3],
  ] as const)("keeps a single local count: %s", async (query, tool, count) => {
    expect(palChatRecordQuery(query)).toBe(query);
    const response = await ask(query);
    expect(response.status).toBe(200);
    const body = await response.json() as { toolsUsed: string[]; cards: unknown[] };
    expect(body.toolsUsed).toEqual([tool]);
    expect(body.cards).toHaveLength(count);
    expect(paidSpendBudgetRefusal).not.toHaveBeenCalled();
    expect(deniedFetch).not.toHaveBeenCalled();
  });

  it.each([
    "Find three pubs for four of us in Soho",
    "Find three pubs and four friends in Soho",
    "Find three pubs in Soho under £6.50 a pint",
    "Plan a crawl in Soho with three pubs for four of us",
    "Plan a crawl in Soho with three pubs and four friends",
    "Plan a crawl in Soho with three pubs at 8 pm",
    "Plan a crawl in Soho with three pubs and 8 pm",
  ])("keeps a single local count with a party, time or price modifier: %s", async (query) => {
    expect(palChatRecordQuery(query)).toBe(query);
    const response = await ask(query);
    expect(response.status).toBe(200);
    expect(paidSpendBudgetRefusal).not.toHaveBeenCalled();
    expect(deniedFetch).not.toHaveBeenCalled();
  });
});

const UNRESOLVED_QUANTITIES = [
  "Plan a crawl in Soho with four LGBTQ+ pubs",
  "Plan a crawl in Soho with a dozen pubs",
  "Plan a crawl in Soho with a pair of pubs",
  "Plan a crawl in Soho with three pubs and a dozen pubs",
  "Plan a crawl in Soho with three pubs and a pair of pubs",
  "Plan a crawl in Soho with a dozen stops",
  "Plan a crawl in Soho with a pair of venues",
  "Plan a dozen-stop crawl in Soho",
  "Plan a three-stop crawl in Soho with a dozen pubs",
  "Plan a crawl in Soho with three stops and a pair of bars",
];

describe("unresolved stop and venue quantities against the fixed three-stop plan", () => {
  it.each(UNRESOLVED_QUANTITIES)("rejects a direct unresolved quantity in the public predicate: %s", (query) => {
    expect(palChatRecordQuery(query)).toBeNull();
    expect(palChatRecordQuery(query.replace(" in Soho", " in the same area"), [{ role: "user", content: SOHO }])).toBeNull();
  });

  it.each(UNRESOLVED_QUANTITIES)("rejects an owned same-area unresolved quantity in the public predicate: %s", async (query) => {
    const followUp = query.replace(" in Soho", " in the same area");
    await registerPubPalToolTurn(THREAD, { query: SOHO, cityId: "london", ownerId: OWNER, turns: [] });
    const context = await preparePalElevenLabsChatTurn({ query: followUp, ownerId: OWNER, threadId: THREAD });
    expect(palChatRecordQuery(followUp, context.prior.turns)).toBeNull();
  });

  it.each(UNRESOLVED_QUANTITIES)("keeps a direct unresolved quantity on the configured HTTP provider path: %s", async (query) => {
    const response = await ask(query);
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: "Paid budget spent" });
    expect(paidSpendBudgetRefusal).toHaveBeenCalledOnce();
    expect(deniedFetch).not.toHaveBeenCalled();
  });

  it.each(UNRESOLVED_QUANTITIES)("keeps an owned same-area unresolved quantity on the configured HTTP provider path: %s", async (query) => {
    const followUp = query.replace(" in Soho", " in the same area");
    await registerPubPalToolTurn(THREAD, { query: SOHO, cityId: "london", ownerId: OWNER, turns: [] });
    const response = await ask(followUp, THREAD);
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: "Paid budget spent" });
    expect(paidSpendBudgetRefusal).toHaveBeenCalledOnce();
    expect(deniedFetch).not.toHaveBeenCalled();
  });

  it.each([
    "Plan a pub crawl in Soho",
    "A pub crawl in Soho for three, not pricey",
    "Plan a crawl in Soho with three garden pubs",
    "Plan a crawl in Soho for four of us at 8 pm with three garden pubs",
  ])("keeps a default or fully resolved three-stop crawl local: %s", async (query) => {
    expect(palChatRecordQuery(query)).toBe(query);
    const response = await ask(query);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ toolsUsed: ["propose_plan"] });
    expect(paidSpendBudgetRefusal).not.toHaveBeenCalled();
    expect(deniedFetch).not.toHaveBeenCalled();
  });

  it.each(["Plan a pub crawl in the same area", "Plan a crawl in the same area with three pubs"])(
    "keeps an owned default or three-pub crawl local with a three-stop draft: %s", async (query) => {
      await registerPubPalToolTurn(THREAD, { query: SOHO, cityId: "london", ownerId: OWNER, turns: [] });
      const context = await preparePalElevenLabsChatTurn({ query, ownerId: OWNER, threadId: THREAD });
      expect(palChatRecordQuery(query, context.prior.turns)).toBe(query.replace("in the same area", "in Soho"));
      const response = await ask(query, THREAD);
      expect(response.status).toBe(200);
      const body = await response.json() as {
        toolsUsed: string[];
        cards: Array<{ venueId: string }>;
        proposals: Array<{ kind: string; stopIds?: string[] }>;
      };
      expect(body.toolsUsed).toEqual(["propose_plan"]);
      expect(body.cards).toHaveLength(3);
      expect(body.proposals.find((proposal) => proposal.kind === "draft_plan")?.stopIds).toHaveLength(3);
      expect(paidSpendBudgetRefusal).not.toHaveBeenCalled();
      expect(deniedFetch).not.toHaveBeenCalled();
    },
  );
});

const COMPLETE_QUANTITY_RESIDUALS = [
  "Find twenty-three pubs in Soho",
  "Find twenty three pubs in Soho",
  "Find 2.3 pubs in Soho",
  "Find three pubs followed by three more in Soho",
  "Find three pubs alongside three more in Soho",
  "Find three pubs in Soho then three more",
  "Find three pubs in Soho plus three more",
  "Plan a crawl in Soho with three pubs followed by three more",
  "Plan a crawl in Soho with three pubs alongside three more",
  "Plan a pub crawl in Soho followed by three more",
  "Plan a three-stop crawl in Soho plus three more",
  "Pints under £6.50 in Soho across 23 pubs",
  "Pints under £6.50 in Soho across twenty-three pubs",
  "Pints under £6.50 in Soho across twenty three pubs",
  "Pints under £6.50 in Soho across three pubs followed by three more",
  "Find three pubs and a dozen pubs in Soho",
  "Find three pubs and a dozen more in Soho",
  "Find three more pubs in Soho",
  "Plan a crawl in Soho with three pubs and a dozen more",
  "Pints under £6.50 in Soho across a dozen pubs",
  "Plan a crawl in Soho with a dozen exceptionally welcoming dog-friendly riverside garden pubs",
];

const COMPLETE_SUPPORTED_QUANTITIES = [
  ["Find two pubs in Soho for three of us", "search_venues", 2],
  ["Pints under £6.50 in Soho across three pubs", "search_venues", 3],
  ["Plan a crawl in Soho for three with three pubs", "propose_plan", 3],
] as const;

describe("complete requested venue quantity at the local answer boundary", () => {
  it.each(COMPLETE_QUANTITY_RESIDUALS)("rejects a direct truncated or additive quantity in the public predicate: %s", (query) => {
    expect(palChatRecordQuery(query)).toBeNull();
  });

  it.each(COMPLETE_QUANTITY_RESIDUALS)("rejects an owned same-area truncated or additive quantity in the public predicate: %s", async (query) => {
    const followUp = query.replace(" in Soho", " in the same area");
    await registerPubPalToolTurn(THREAD, { query: SOHO, cityId: "london", ownerId: OWNER, turns: [] });
    const context = await preparePalElevenLabsChatTurn({ query: followUp, ownerId: OWNER, threadId: THREAD });
    expect(palChatRecordQuery(followUp, context.prior.turns)).toBeNull();
  });

  it.each(COMPLETE_QUANTITY_RESIDUALS)("keeps a direct truncated or additive quantity on the configured HTTP provider path: %s", async (query) => {
    const response = await ask(query);
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: "Paid budget spent" });
    expect(paidSpendBudgetRefusal).toHaveBeenCalledOnce();
    expect(deniedFetch).not.toHaveBeenCalled();
  });

  it.each(COMPLETE_QUANTITY_RESIDUALS)("keeps an owned same-area truncated or additive quantity on the configured HTTP provider path: %s", async (query) => {
    const followUp = query.replace(" in Soho", " in the same area");
    await registerPubPalToolTurn(THREAD, { query: SOHO, cityId: "london", ownerId: OWNER, turns: [] });
    const response = await ask(followUp, THREAD);
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: "Paid budget spent" });
    expect(paidSpendBudgetRefusal).toHaveBeenCalledOnce();
    expect(deniedFetch).not.toHaveBeenCalled();
  });

  it.each(COMPLETE_SUPPORTED_QUANTITIES)("keeps a complete supported quantity local in the public predicate: %s", (query) => {
    expect(palChatRecordQuery(query)).toBe(query);
  });

  it.each(COMPLETE_SUPPORTED_QUANTITIES)("answers a complete supported quantity locally over configured HTTP: %s", async (query, tool, count) => {
    const response = await ask(query);
    expect(response.status).toBe(200);
    const body = await response.json() as { toolsUsed: string[]; cards: unknown[] };
    expect(body.toolsUsed).toEqual([tool]);
    expect(body.cards).toHaveLength(count);
    expect(paidSpendBudgetRefusal).not.toHaveBeenCalled();
    expect(deniedFetch).not.toHaveBeenCalled();
  });
});

const ELLIPTICAL_ADDITIVE_QUANTITIES = [
  "Find three pubs followed by a dozen in Soho",
  "Find three pubs plus a couple in Soho",
  "Plan a crawl in Soho with three pubs followed by a dozen",
  "Pints under £6.50 in Soho across three pubs followed by a dozen",
];

describe("additive word quantities without a second venue noun", () => {
  it.each(ELLIPTICAL_ADDITIVE_QUANTITIES)("leaves the shared venue quantity unresolved: %s", (query) => {
    expect(requestedVenueQuantity(query)).toBeNull();
    expect(requestedVenueQuantity(query.replace(" in Soho", " in the same area"))).toBeNull();
  });

  it.each(["Find three pubs followed by a dozen in Soho", "Find three pubs plus a couple in Soho"])(
    "routes the default discovery count instead of the first conjunct: %s", (query) => {
      expect(routeAskDeterministically(query)).toEqual([{ name: "search_venues", args: { query, limit: 4 } }]);
    },
  );

  it.each(ELLIPTICAL_ADDITIVE_QUANTITIES)("keeps a direct elliptical quantity on the configured HTTP provider path: %s", async (query) => {
    expect(palChatRecordQuery(query)).toBeNull();
    const response = await ask(query);
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: "Paid budget spent" });
    expect(paidSpendBudgetRefusal).toHaveBeenCalledOnce();
    expect(deniedFetch).not.toHaveBeenCalled();
  });

  it.each(ELLIPTICAL_ADDITIVE_QUANTITIES)("keeps an owned same-area elliptical quantity on the configured HTTP provider path: %s", async (query) => {
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
    ["Find four pubs in Soho", 4],
    ["Find three pubs and four friends in Soho", 3],
    ["Plan a crawl in Soho with three pubs and 8 pm", 3],
    ["A three-stop pub crawl in Soho", 3],
    ["Four pubs in Soho with food and a garden", 4],
    ["A pub crawl in Soho for three, not pricey", undefined],
  ] as const)("keeps a complete single venue quantity: %s", (query, count) => {
    expect(requestedVenueQuantity(query)).toBe(count);
  });
});

function placedPub(id: string, name: string, searchText: string, area: string, lat: number, lng: number): ConciergeVenue {
  return { ...listedPub(id, name, searchText), area, lat, lng };
}

const TEXT_MEMBERSHIP_VENUES = [
  listedPub("soho-one", "Soho One"),
  listedPub("oxford-arms", "Oxford Arms"),
  placedPub("market-porter", "Market Porter", "Market Porter 9 Stoney Street Borough Market London SE1", "Southwark", 51.5053, -0.0912),
  placedPub("globe-tavern", "Globe Tavern", "Globe Tavern 8 Bedale Street Borough Market London SE1", "Southwark", 51.5052, -0.0909),
  placedPub("rake", "Rake", "Rake 14 Winchester Walk Borough Market London SE1", "Southwark", 51.5058, -0.0915),
  placedPub("wheatsheaf", "Wheatsheaf", "Wheatsheaf 6 Stoney Street London SE1", "Southwark", 51.5054, -0.0911),
  placedPub("warrington", "Warrington", "Warrington 93 Warrington Crescent Maida Vale London W9", "Westminster", 51.5266, -0.1866),
  placedPub("elgin", "Elgin", "Elgin 255 Elgin Avenue London W9", "Westminster", 51.5268, -0.1903),
];

const BOROUGH_MARKET_MEMBERS = ["globe-tavern", "market-porter", "rake"];

describe("area text membership outside a night-area circle", () => {
  beforeEach(() => {
    vi.mocked(loadConciergeVenues).mockResolvedValue(TEXT_MEMBERSHIP_VENUES);
  });

  it.each([
    ["Find four pubs near Borough Market", BOROUGH_MARKET_MEMBERS],
    ["Find four pubs in Maida Vale", ["warrington"]],
  ] as const)("searches only pubs whose own records name the place: %s", async (query, ids) => {
    const result = await runAskTool("search_venues", { query, limit: 4 }, { cityId: "london", query, skipModel: true });
    expect(result.ok).toBe(true);
    expect(result.cards.map((card) => card.venueId).sort()).toEqual([...ids]);
    expect(result.answerHint).toContain(`Only ${ids.length} listed`);
    expect(result.cards.every((card) => !/\bNear\b/.test(card.note))).toBe(true);
  });

  it("plans a Borough Market crawl from its text members alone", async () => {
    const query = "Plan a crawl near Borough Market";
    const result = await runAskTool("propose_plan", {}, { cityId: "london", query, skipModel: true });
    expect(result.ok).toBe(true);
    expect(result.cards.map((card) => card.venueId).sort()).toEqual(BOROUGH_MARKET_MEMBERS);
    expect(result.proposals.find((proposal) => proposal.kind === "draft_plan")).toMatchObject({ label: "Open in Plan", query });
  });

  it("withholds a Maida Vale crawl when one listed pub names it", async () => {
    const query = "Plan a crawl in Maida Vale";
    const result = await runAskTool("propose_plan", {}, { cityId: "london", query, skipModel: true });
    expect(result.ok).toBe(false);
    expect(result.cards.map((card) => card.venueId)).toEqual(["warrington"]);
    expect(result.proposals).toEqual([]);
  });

  it("keeps the existing Soho night-area circle beside its text members", async () => {
    const query = "Find four pubs in Soho";
    const result = await runAskTool("search_venues", { query, limit: 4 }, { cityId: "london", query, skipModel: true });
    expect(result.cards.map((card) => card.venueId).sort()).toEqual(["oxford-arms", "soho-one"]);
    expect(result.cards.find((card) => card.venueId === "oxford-arms")?.note).toContain("Near Piccadilly & Soho");
  });

  it("answers Borough Market discovery locally with honest scarcity over configured HTTP", async () => {
    const response = await ask("Find four pubs near Borough Market");
    expect(response.status).toBe(200);
    const body = await response.json() as { toolsUsed: string[]; cards: Array<{ venueId: string; provenance?: { label?: string } }> };
    expect(body.toolsUsed).toEqual(["search_venues"]);
    expect(body.cards.map((card) => card.venueId).sort()).toEqual(BOROUGH_MARKET_MEMBERS);
    expect(body.cards.every((card) => Boolean(card.provenance?.label))).toBe(true);
    expect(paidSpendBudgetRefusal).not.toHaveBeenCalled();
    expect(deniedFetch).not.toHaveBeenCalled();
  });
});
