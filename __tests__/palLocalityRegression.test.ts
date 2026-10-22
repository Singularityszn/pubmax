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
import { refineRoutedAskQuery, refineVenueAreaFollowUp } from "@/lib/ask/router";
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
