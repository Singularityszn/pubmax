import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const voiceState = vi.hoisted(() => ({
  configured: true,
  events: [] as string[],
  rpc: vi.fn(),
  userId: "11111111-1111-4111-8111-111111111111",
}));

vi.mock("@/lib/authServer", () => ({
  callerUserId: async () => voiceState.userId,
}));

vi.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => voiceState.configured,
  requireSupabaseAdmin: () => ({ rpc: voiceState.rpc }),
}));

import { POST } from "@/app/api/pub-pal/voice-token/route";

const request = () => new Request("http://localhost/api/pub-pal/voice-token", { method: "POST" });

describe("Pub Pal voice token route", () => {
  beforeEach(() => {
    voiceState.configured = true;
    voiceState.events.length = 0;
    voiceState.rpc.mockReset();
    voiceState.userId = "11111111-1111-4111-8111-111111111111";
    vi.stubEnv("ELEVENLABS_API_KEY", "server-only-key");
    vi.stubEnv("ELEVENLABS_PUB_PAL_AGENT_ID", "pub-pal-agent");
  });

  afterEach(() => {
    vi.restoreAllMocks();
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

  it.each([
    {
      label: "returns an RPC error",
      release: () => ({ data: null, error: { message: "x".repeat(500) } }),
      reason: "rpc_error",
    },
    {
      label: "throws",
      release: () => {
        throw new Error("release unavailable");
      },
      reason: "rpc_exception",
    },
    {
      label: "reports no released row",
      release: () => ({ data: false, error: null }),
      reason: "not_released",
    },
  ])("logs one actionable reconciliation event when compensation $label", async ({ release, reason }) => {
    voiceState.rpc.mockImplementation(async (name: string) => {
      voiceState.events.push(name);
      if (name === "release_pub_pal_voice_trial") return release();
      return { data: true, error: null };
    });
    vi.stubGlobal("fetch", vi.fn(async () => {
      voiceState.events.push("provider_allocation");
      return new Response(null, { status: 503 });
    }));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await POST(request());

    expect(response.status).toBe(502);
    expect(consoleError).toHaveBeenCalledTimes(1);
    const record = JSON.parse(String(consoleError.mock.calls[0]?.[0])) as Record<string, unknown>;
    expect(record).toMatchObject({
      level: "error",
      event: "pub_pal.voice_quota_release_failed",
      ownerId: voiceState.userId,
      reason,
    });
    expect(record.usageMonth).toMatch(/^\d{4}-\d{2}-01$/);
    expect(String(record.error).length).toBeLessThanOrEqual(160);
  });

  it("allocates and accounts for a keyless in-memory provider success", async () => {
    voiceState.configured = false;
    voiceState.userId = "55555555-5555-4555-8555-555555555555";
    vi.stubGlobal("fetch", vi.fn(async () => {
      voiceState.events.push("provider_allocation");
      return Response.json({ signed_url: "wss://voice.example/session" });
    }));

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ remaining: 9 });
    expect(voiceState.rpc).not.toHaveBeenCalled();
  });

  it("releases a keyless in-memory reservation after provider failure", async () => {
    voiceState.configured = false;
    voiceState.userId = "66666666-6666-4666-8666-666666666666";
    const providerFetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(Response.json({ signed_url: "wss://voice.example/session" }));
    vi.stubGlobal("fetch", providerFetch);

    expect((await POST(request())).status).toBe(502);
    const recovered = await POST(request());

    expect(recovered.status).toBe(200);
    expect(await recovered.json()).toMatchObject({ remaining: 9 });
    expect(voiceState.rpc).not.toHaveBeenCalled();
  });
});
