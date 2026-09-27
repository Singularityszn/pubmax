import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const limitState = vi.hoisted(() => ({ limited: false }));

vi.mock("@/lib/pintDrops", () => ({
  isLimited: vi.fn(async () => limitState.limited),
}));

vi.mock("@/lib/supabase", () => ({
  clientIp: () => "203.0.113.44",
  hashIp: (ip: string) => `hashed:${ip}`,
  isSupabaseConfigured: () => false,
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
    vi.mocked(runAskTool).mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
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
});
