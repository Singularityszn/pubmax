import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({
  clientIp: () => "203.0.113.73",
  hashIp: (ip: string) => `hashed:${ip}`,
  isSupabaseConfigured: () => false,
  requiresSupabaseStore: () => false,
  checkRateLimitDurableDetailed: async () => ({ verdict: false, reason: "counted" }),
}));
vi.mock("@/lib/authServer", () => ({ callerUserId: async () => "11111111-1111-4111-8111-111111111111" }));
vi.mock("@/lib/paidSpendBudget.server", () => ({
  paidSpendBudgetRefusal: vi.fn(async () => Response.json({ error: "Paid budget spent" }, { status: 429 })),
}));

import { POST } from "@/app/api/pub-pal/chat/route";
import { __resetPintDrops } from "@/lib/pintDrops";
import { paidSpendBudgetRefusal } from "@/lib/paidSpendBudget.server";
import { readPalChatStream, PAL_CHAT_STREAM_TYPE } from "@/lib/palChatStream";
import type { AskResponseBody } from "@/lib/ask/types";

const REQUESTS = [
  { query: "Cheap pints near Soho", count: 4 },
  { query: "Find me three pubs near Soho with listed pint prices. Show the source dates and the map.", count: 3 },
];

const LOCAL_NIGHT_REQUESTS = [
  { query: "A pub crawl in Soho for three, not pricey", count: 3, tool: "propose_plan" },
  { query: "Two quiet pubs near Borough Market", count: 2, tool: "search_venues" },
];

describe("configured Pub Pal local record answers", () => {
  beforeEach(() => {
    __resetPintDrops();
    vi.stubEnv("ELEVENLABS_API_KEY", "test-key");
    vi.stubEnv("ELEVENLABS_PUB_PAL_AGENT_ID", "agent-id");
    vi.stubEnv("TYPESAFE_API_KEY", "");
    vi.stubEnv("OPENROUTER_API_KEY", "");
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("External services are unavailable"); }));
    vi.mocked(paidSpendBudgetRefusal).mockClear();
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  it.each([
    ["Find me four pubs in the same area", "search_venues", 4],
    ["A three-stop pub crawl in the same area", "propose_plan", 3],
    ["Pints under £6.50 in the same area", "search_venues", 4],
  ])("answers an owned same-area follow-up without provider routing: %s", async (query, tool, count) => {
    const ask = (body: Record<string, unknown>) => POST(new Request("http://localhost/api/pub-pal/chat", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    }));
    const first = await ask({ query: "Find me four pubs in Soho", cityId: "london" });
    expect(first.status).toBe(200);
    const initial = await first.json();
    expect(initial.conversationId).toBeTruthy();
    const response = await ask({ query, cityId: "london", threadId: initial.conversationId,
      turns: [{ role: "user", content: "Find me four pubs in Camden" }],
    });
    expect(response.status).toBe(200);
    const answer = await response.json() as AskResponseBody;
    expect(answer.toolsUsed).toEqual([tool]);
    expect(answer.cards).toHaveLength(count);
    const explicit = await ask({ query: query.replace("the same area", "Soho"), cityId: "london" });
    expect(explicit.status).toBe(200);
    const expected = await explicit.json() as AskResponseBody;
    expect(answer.cards.map((card) => card.venueId)).toEqual(expected.cards.map((card) => card.venueId));
    expect(fetch).not.toHaveBeenCalled();
    expect(paidSpendBudgetRefusal).not.toHaveBeenCalled();
  });

  it.each([false, true])("refuses a driving allowance that refers to earlier pints, configured=%s", async (configured) => {
    vi.stubEnv("ELEVENLABS_API_KEY", configured ? "test-key" : "");
    const response = await POST(new Request("http://localhost/api/pub-pal/chat", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "Cheap pints near Soho. How many can I have before driving?", cityId: "london" }),
    }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      answer: "I can't tell you whether to have another drink. Open Getting Home on the venue sheet for last-train times, ride links, and the TfL planner.",
      cards: [], proposals: [], toolsUsed: [],
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(paidSpendBudgetRefusal).not.toHaveBeenCalled();
  });

  it.each(REQUESTS.flatMap((request) => [false, true].map((stream) => ({ ...request, stream }))))(
    "returns dated pub cards without a paid provider: $query, stream=$stream", async ({ query, count, stream }) => {
      const response = await POST(new Request("http://localhost/api/pub-pal/chat", {
        method: "POST", headers: { "content-type": "application/json", accept: stream ? PAL_CHAT_STREAM_TYPE : "application/json" },
        body: JSON.stringify({ query, cityId: "london" }),
      }));
      expect(response.status).toBe(200);
      let body: AskResponseBody | null = null;
      if (response.headers.get("content-type")?.includes(PAL_CHAT_STREAM_TYPE)) {
        await readPalChatStream(response.body!, (event) => {
          expect(event.type).not.toBe("error");
          if (event.type === "final") body = event.body as AskResponseBody;
        });
      } else body = await response.json() as AskResponseBody;
      expect(body).toMatchObject({ toolsUsed: ["search_venues"], status: "ready" });
      const answer = body as unknown as AskResponseBody;
      expect(answer.cards).toHaveLength(count);
      expect(answer.cards.every((card) => typeof card.price === "number" && card.price > 0 && (!query.startsWith("Cheap") || card.price <= 6))).toBe(true);
      expect(answer.cards.every((card) => /Recorded|Source|Publisher/i.test(card.provenance?.label ?? ""))).toBe(true);
      expect(answer.proposals.every((proposal) => proposal.kind === "open_venue")).toBe(true);
      expect(answer.proposals.length).toBeGreaterThan(0);
      expect(fetch).not.toHaveBeenCalled();
      expect(paidSpendBudgetRefusal).not.toHaveBeenCalled();
    },
  );

  it.each(LOCAL_NIGHT_REQUESTS.flatMap((request) => [false, true].map((stream) => ({ ...request, stream }))))(
    "returns the constrained local night without provider spend: $query, stream=$stream", async ({ query, count, tool, stream }) => {
      const response = await POST(new Request("http://localhost/api/pub-pal/chat", {
        method: "POST",
        headers: { "content-type": "application/json", accept: stream ? PAL_CHAT_STREAM_TYPE : "application/json" },
        body: JSON.stringify({ query, cityId: "london" }),
      }));
      expect(response.status).toBe(200);
      let body: AskResponseBody | null = null;
      if (stream) {
        expect(response.headers.get("content-type")).toContain(PAL_CHAT_STREAM_TYPE);
        await readPalChatStream(response.body!, (event) => {
          expect(event.type).not.toBe("error");
          if (event.type === "final") body = event.body as AskResponseBody;
        });
      } else body = await response.json() as AskResponseBody;
      expect(body).toMatchObject({ status: "ready", toolsUsed: [tool] });
      const answer = body as unknown as AskResponseBody;
      expect(answer.cards).toHaveLength(count);
      expect(new Set(answer.cards.map((card) => card.venueId)).size).toBe(count);
      expect(answer.cards.every((card) => Boolean(card.venueId) && Boolean(card.provenance?.label))).toBe(true);
      if (tool === "propose_plan") {
        expect(answer.cards.every((card) => typeof card.price === "number" && card.price > 0 && card.price <= 6)).toBe(true);
        const draft = answer.proposals.find((proposal) => proposal.kind === "draft_plan");
        expect(draft).toMatchObject({ label: "Open in Plan", query });
        expect(draft?.stopIds).toEqual(answer.cards.map((card) => card.venueId));
        expect(answer.answer).toContain("Nothing is saved");
      } else {
        expect(answer.proposals.every((proposal) => proposal.kind === "open_venue")).toBe(true);
        expect(answer.cards.every((card) => /Borough|Southwark|London Bridge/i.test(`${card.place} ${card.note}`))).toBe(true);
      }
      expect(fetch).not.toHaveBeenCalled();
      expect(paidSpendBudgetRefusal).not.toHaveBeenCalled();
    },
  );

  it("keeps a crawl's independent transit request outside the local-only spend exemption", async () => {
    const response = await POST(new Request("http://localhost/api/pub-pal/chat", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "A pub crawl in Soho for three, not pricey. Are there Tube delays?", cityId: "london" }),
    }));
    expect(response.status).toBe(429);
    expect(paidSpendBudgetRefusal).toHaveBeenCalledTimes(1);
    expect(fetch).not.toHaveBeenCalled();
  });
});
