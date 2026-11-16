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

const claude = vi.hoisted(() => ({ reply: "", tool: "" }));
vi.mock("@/lib/claudeClient.server", async (original) => ({
  ...await original<typeof import("@/lib/claudeClient.server")>(),
  claudeClient: () => ({
    stream: (body: { messages: unknown[] }) => {
      const listeners: Array<(delta: string) => void> = [];
      const callsTool = Boolean(claude.tool) && body.messages.length === 1;
      return {
        on(_event: "text", listener: (delta: string) => void) {
          listeners.push(listener);
          return this;
        },
        async finalMessage() {
          for (const listener of listeners) listener(`${claude.reply} `);
          return {
            id: "msg_test", type: "message", role: "assistant", model: "claude-haiku-5-5",
            content: [
              { type: "text", text: claude.reply, citations: null },
              ...(callsTool ? [{ type: "tool_use", id: "tu_1", name: claude.tool, input: { query: "quiet pubs in Soho" } }] : []),
            ],
            stop_reason: callsTool ? "tool_use" : "end_turn", stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 },
          };
        },
      };
    },
  }),
}));

import { INVENTED_VENUE_REPLIES } from "./fixtures/palInventedVenueReplies";
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
    vi.stubEnv("ANTHROPIC_API_KEY", "");
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

describe("typed Pub Pal on Claude with no tool evidence", () => {
  beforeEach(() => {
    __resetPintDrops();
    claude.tool = "";
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    vi.stubEnv("TYPESAFE_API_KEY", "");
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("External services are unavailable"); }));
    vi.mocked(paidSpendBudgetRefusal).mockResolvedValue(null);
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  async function ask(stream: boolean, query = "Is The Crown in Soho any good?") {
    const response = await POST(new Request("http://localhost/api/pub-pal/chat", {
      method: "POST", headers: { "content-type": "application/json", accept: stream ? PAL_CHAT_STREAM_TYPE : "application/json" },
      body: JSON.stringify({ query, cityId: "london" }),
    }));
    expect(response.status).toBe(200);
    if (!stream) return { deltas: [] as string[], body: await response.json() as AskResponseBody };
    const deltas: string[] = [];
    let body: AskResponseBody | null = null;
    await readPalChatStream(response.body!, (event) => {
      if (event.type === "reset") deltas.length = 0;
      if (event.type === "delta") deltas.push(event.text);
      if (event.type === "final") body = event.body as AskResponseBody;
    });
    return { deltas, body: body as unknown as AskResponseBody };
  }

  it.each([false, true].flatMap((stream) => ["", "propose_plan"].map((tool) => ({ stream, tool }))))(
    "keeps missing crawl details out of a generated plan, stream=$stream, tool=$tool", async ({ stream, tool }) => {
      claude.tool = tool;
      claude.reply = "The Golden Lion is perfect for your crawl.";
      const { deltas, body } = await ask(stream, "Plan a pub crawl for my birthday, six of us");
      expect(body.cards).toEqual([]);
      expect(body.proposals).toEqual([]);
      expect(body.answer).toMatch(/which area/i);
      expect(body.answer).toMatch(/what time/i);
      expect(deltas.join(" ")).not.toContain("Golden Lion");
    },
  );

  it.each(INVENTED_VENUE_REPLIES.flatMap((reply) => [false, true].map((stream) => ({ reply, stream }))))(
    "sends no model prose for $reply, stream=$stream", async ({ reply, stream }) => {
      claude.reply = "Okay.";
      const control = await ask(stream);
      claude.reply = reply;
      const { deltas, body } = await ask(stream);
      expect(deltas).toEqual(control.deltas);
      expect(deltas.join(" ")).not.toContain(reply);
      expect(body).toMatchObject({ status: "ready", cards: control.body.cards, answer: control.body.answer });
      expect(control.body.answer).toBeTruthy();
    },
  );

  it("shows a tool progress line while a tool runs, never the model's text", async () => {
    claude.tool = "search_venues";
    claude.reply = "Checking The Golden Lion and its garden.";
    const events: string[] = [];
    const response = await POST(new Request("http://localhost/api/pub-pal/chat", {
      method: "POST", headers: { "content-type": "application/json", accept: PAL_CHAT_STREAM_TYPE },
      body: JSON.stringify({ query: "Is The Crown in Soho any good?", cityId: "london" }),
    }));
    await readPalChatStream(response.body!, (event) => {
      events.push(event.type === "delta" ? `delta:${event.text}` : event.type);
    });

    expect(events.at(-1)).toBe("final");
    const progress = events.filter((event) => event.startsWith("delta:"));
    expect(progress).toHaveLength(1);
    expect(events.join(" ")).not.toMatch(/Golden Lion|garden/);
  });
});
