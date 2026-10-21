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
});
