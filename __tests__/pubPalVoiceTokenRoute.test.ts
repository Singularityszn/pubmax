import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const voiceState = vi.hoisted(() => ({
  events: [] as string[],
  rpc: vi.fn(),
}));

vi.mock("@/lib/authServer", () => ({
  callerUserId: async () => "11111111-1111-4111-8111-111111111111",
}));

vi.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => true,
  requireSupabaseAdmin: () => ({ rpc: voiceState.rpc }),
}));

import { POST } from "@/app/api/pub-pal/voice-token/route";

const request = () => new Request("http://localhost/api/pub-pal/voice-token", { method: "POST" });

describe("Pub Pal voice token route", () => {
  beforeEach(() => {
    voiceState.events.length = 0;
    voiceState.rpc.mockReset();
    vi.stubEnv("ELEVENLABS_API_KEY", "server-only-key");
    vi.stubEnv("ELEVENLABS_PUB_PAL_AGENT_ID", "pub-pal-agent");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("does not allocate a provider session when quota reservation is refused", async () => {
    voiceState.rpc.mockImplementation(async (name: string) => {
      voiceState.events.push(name);
      return { data: false, error: null };
    });
    const providerFetch = vi.fn(async () => {
      voiceState.events.push("provider_allocation");
      return Response.json({ signed_url: "wss://voice.example/session" });
    });
    vi.stubGlobal("fetch", providerFetch);

    const response = await POST(request());

    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({ remaining: 0, fallback: "text" });
    expect(providerFetch).not.toHaveBeenCalled();
    expect(voiceState.events).toEqual(["consume_pub_pal_voice_trial"]);
  });

  it("does not allocate a provider session when quota reservation errors", async () => {
    voiceState.rpc.mockImplementation(async (name: string) => {
      voiceState.events.push(name);
      throw new Error("quota backend unavailable");
    });
    const providerFetch = vi.fn();
    vi.stubGlobal("fetch", providerFetch);

    const response = await POST(request());

    expect(response.status).toBe(503);
    expect(providerFetch).not.toHaveBeenCalled();
    expect(voiceState.events).toEqual(["consume_pub_pal_voice_trial"]);
  });

  it("releases one reservation when provider allocation fails", async () => {
    voiceState.rpc.mockImplementation(async (name: string) => {
      voiceState.events.push(name);
      return { data: true, error: null };
    });
    vi.stubGlobal("fetch", vi.fn(async () => {
      voiceState.events.push("provider_allocation");
      return new Response(null, { status: 503 });
    }));

    const response = await POST(request());

    expect(response.status).toBe(502);
    expect(voiceState.events).toEqual([
      "consume_pub_pal_voice_trial",
      "provider_allocation",
      "release_pub_pal_voice_trial",
    ]);
  });

  it("keeps a successful reservation after provider allocation", async () => {
    voiceState.rpc.mockImplementation(async (name: string) => {
      voiceState.events.push(name);
      return { data: true, error: null };
    });
    vi.stubGlobal("fetch", vi.fn(async () => {
      voiceState.events.push("provider_allocation");
      return Response.json({ signed_url: "wss://voice.example/session" });
    }));

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(voiceState.events).toEqual([
      "consume_pub_pal_voice_trial",
      "provider_allocation",
    ]);
  });
});
