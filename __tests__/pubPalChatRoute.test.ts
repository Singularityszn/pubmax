import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({
  clientIp: () => "203.0.113.44",
  hashIp: (ip: string) => `hashed:${ip}`,
  isSupabaseConfigured: () => false,
  checkRateLimitDurableDetailed: async () => ({ verdict: false, reason: "counted" }),
}));

vi.mock("@/lib/palElevenLabsChat.server", () => ({
  runPalElevenLabsChatTurn: vi.fn(),
}));

import { POST } from "@/app/api/pub-pal/chat/route";
import { PAL_ERROR_FALLBACK } from "@/lib/palChat";
import { runPalElevenLabsChatTurn } from "@/lib/palElevenLabsChat.server";

describe("POST /api/pub-pal/chat", () => {
  beforeEach(() => {
    vi.stubEnv("ELEVENLABS_API_KEY", "test-key");
    vi.stubEnv("ELEVENLABS_PUB_PAL_AGENT_ID", "agent-id");
    vi.mocked(runPalElevenLabsChatTurn).mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns the curated fallback when ElevenLabs is not configured", async () => {
    vi.stubEnv("ELEVENLABS_API_KEY", "");
    const response = await POST(
      new Request("http://localhost/api/pub-pal/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: "Cheapest pint in Clapham?" }),
      }),
    );
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.error).toBe(PAL_ERROR_FALLBACK);
  });

  it("returns the curated fallback when the provider turn fails", async () => {
    vi.mocked(runPalElevenLabsChatTurn).mockResolvedValue({ ok: false, code: "TIMEOUT" });
    const response = await POST(
      new Request("http://localhost/api/pub-pal/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: "Cheapest pint in Clapham?" }),
      }),
    );
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.error).toBe(PAL_ERROR_FALLBACK);
  });
});
