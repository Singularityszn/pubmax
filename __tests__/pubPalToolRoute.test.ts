import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const limitState = vi.hoisted(() => ({ limited: false }));

vi.mock("@/lib/pintDrops", () => ({
  isLimited: vi.fn(async () => limitState.limited),
}));

vi.mock("@/lib/supabase", () => ({
  clientIp: () => "203.0.113.44",
  hashIp: (ip: string) => `hashed:${ip}`,
  isSupabaseConfigured: () => false,
  requiresSupabaseStore: () => false,
  checkRateLimitDurableDetailed: async () => ({ verdict: false, reason: "counted" }),
}));

vi.mock("@/lib/ask/tools", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ask/tools")>();
  return {
    ...actual,
    runAskTool: vi.fn(async () => ({
      ok: true,
      tool: "search_venues",
      data: null,
      provenance: [],
      cards: [
        {
          key: "v1",
          venueId: "london-a",
          title: "Pub A",
          place: "Clapham",
          note: "On record.",
          price: 5.5,
        },
      ],
      proposals: [],
      answerHint: "Two picks from the listed pubs.",
    })),
  };
});

import { POST } from "@/app/api/pub-pal/tools/[toolName]/route";
import { runAskTool } from "@/lib/ask/tools";
import {
  __resetPubPalToolTurnStore,
  readPubPalToolTurn,
  registerPubPalToolTurn,
} from "@/lib/pubPalToolTurnStore";

function request(toolName: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(`http://localhost/api/pub-pal/tools/${toolName}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer test-llm-secret",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/pub-pal/tools/[toolName]", () => {
  beforeEach(() => {
    limitState.limited = false;
    vi.stubEnv("ELEVENLABS_LLM_SHARED_SECRET", "test-llm-secret");
    vi.stubEnv("TYPESAFE_API_KEY", "");
    vi.mocked(runAskTool).mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    __resetPubPalToolTurnStore();
  });

  it("returns 401 without the shared secret", async () => {
    const response = await POST(
      new Request("http://localhost/api/pub-pal/tools/search_venues", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: "pubs in Soho" }),
      }),
      { params: Promise.resolve({ toolName: "search_venues" }) },
    );
    expect(response.status).toBe(401);
    expect(runAskTool).not.toHaveBeenCalled();
  });

  it("returns 401 for an unknown tool before it admits the name is missing", async () => {
    const response = await POST(
      new Request("http://localhost/api/pub-pal/tools/not_a_tool", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }),
      { params: Promise.resolve({ toolName: "not_a_tool" }) },
    );
    expect(response.status).toBe(401);
    expect(runAskTool).not.toHaveBeenCalled();
  });

  it("returns 401 for a wrong bearer or a wrong secret header", async () => {
    const wrongCredentials: Array<Record<string, string>> = [
      { authorization: "Bearer not-the-secret" },
      { authorization: "", "x-elevenlabs-llm-secret": "not-the-secret" },
    ];
    for (const headers of wrongCredentials) {
      const response = await POST(
        request("search_venues", { parameters: { query: "Soho" } }, headers),
        { params: Promise.resolve({ toolName: "search_venues" }) },
      );
      expect(response.status).toBe(401);
    }
    expect(runAskTool).not.toHaveBeenCalled();
  });

  it("accepts the secret in its dedicated header", async () => {
    const response = await POST(
      request(
        "search_venues",
        { parameters: { query: "quiet pubs" } },
        { authorization: "", "x-elevenlabs-llm-secret": "test-llm-secret" },
      ),
      { params: Promise.resolve({ toolName: "search_venues" }) },
    );
    expect(response.status).toBe(200);
    expect(runAskTool).toHaveBeenCalled();
  });

  it("fails closed when the shared secret is unset, even for a listed tool", async () => {
    vi.stubEnv("ELEVENLABS_LLM_SHARED_SECRET", "");
    for (const toolName of ["search_venues", "not_a_tool"]) {
      const response = await POST(request(toolName, { parameters: { query: "Soho" } }), {
        params: Promise.resolve({ toolName }),
      });
      expect(response.status).toBe(503);
    }
    expect(runAskTool).not.toHaveBeenCalled();
  });

  it("returns 404 for a tool outside the allowlist", async () => {
    const response = await POST(
      request("not_a_tool", {}, { authorization: "Bearer test-llm-secret" }),
      { params: Promise.resolve({ toolName: "not_a_tool" }) },
    );
    expect(response.status).toBe(404);
  });

  it("returns 429 when rate limited", async () => {
    limitState.limited = true;
    const response = await POST(
      request("search_venues", { parameters: { query: "quiet pubs" } }),
      { params: Promise.resolve({ toolName: "search_venues" }) },
    );
    expect(response.status).toBe(429);
    expect(runAskTool).not.toHaveBeenCalled();
  });

  it("invokes an allowlisted tool when authorised", async () => {
    const response = await POST(
      request("search_venues", { parameters: { query: "quiet pubs" } }),
      { params: Promise.resolve({ toolName: "search_venues" }) },
    );
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.result.ok).toBe(true);
    expect(runAskTool).toHaveBeenCalled();
  });

  // The live webhook body on 28 Sep carried no conversation_id, so the tool
  // ran but its result never reached the turn the chat reads.
  it("warns when a webhook body cannot be tied to a conversation", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const response = await POST(request("cheapest_pint_near", { query: "Soho" }), {
      params: Promise.resolve({ toolName: "cheapest_pint_near" }),
    });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.result.ok).toBe(true);
    expect(payload.result.cards).toHaveLength(1);
    expect(warn).toHaveBeenCalledWith("pub-pal-tool.uncorrelated", {
      toolName: "cheapest_pint_near",
    });
  });

  it("stores the tool result for the chat when the body carries conversation_id", async () => {
    const conversationId = "conv_routeplan01";
    const query = "Plan me a 3 pub crawl in Shoreditch tonight";
    await registerPubPalToolTurn(conversationId, {
      query,
      cityId: "london",
      ownerId: "11111111-1111-4111-8111-111111111111",
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const response = await POST(
      request("propose_plan", { conversation_id: conversationId, query }),
      { params: Promise.resolve({ toolName: "propose_plan" }) },
    );

    expect(response.status).toBe(200);
    const turn = await readPubPalToolTurn(conversationId);
    expect(turn?.toolsUsed).toEqual(["propose_plan"]);
    expect(turn?.cards.map((card) => card.venueId)).toEqual(["london-a"]);
    expect(warn).not.toHaveBeenCalledWith("pub-pal-tool.uncorrelated", expect.anything());
  });
});
