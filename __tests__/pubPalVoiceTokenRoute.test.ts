import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PAL_VOICE_MAX_SESSION_SECONDS, PAL_VOICE_MONTHLY_MINUTES } from "@/lib/palVoiceMetering";

const voiceState = vi.hoisted(() => ({
  configured: true,
  events: [] as string[],
  palLookupFails: false,
  palPresent: true,
  rpc: vi.fn(),
  userId: "11111111-1111-4111-8111-111111111111",
  pal: {
    id: "pal-1",
    ownerId: "11111111-1111-4111-8111-111111111111",
    name: "Ripley",
    adultAttestedAt: "2026-08-08T00:00:00.000Z",
    appearance: {
      species: "fox",
      signalAffinity: "gin",
      material: "hologram",
      accessory: "none",
    },
    personality: {
      playfulness: 62,
      energy: 54,
      storytelling: 58,
      relationship: "sidekick",
    },
    voice: { id: "ember", pace: 50, warmth: 64, energy: 52 },
    muted: false,
    hidden: false,
    proposalPreferences: { memories: false, routes: true },
    masteryPoints: 0,
    createdAt: "2026-08-08T00:00:00.000Z",
    updatedAt: "2026-08-08T00:00:00.000Z",
  },
}));

// These tests exercise durable grant accounting, independently of IP throttling.
vi.mock("@/lib/pintDrops", () => ({ isLimited: async () => false }));

vi.mock("@/lib/authServer", () => ({
  callerUserId: async () => voiceState.userId,
}));

vi.mock("@/lib/pubPalStore", () => ({
  getPubPal: async () => voiceState.palLookupFails || !voiceState.palPresent
    ? null
    : voiceState.pal,
  getPubPalResult: async () => voiceState.palLookupFails
    ? { ok: false as const, error: "error" as const }
    : { ok: true as const, value: voiceState.palPresent ? voiceState.pal : null },
}));

vi.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => voiceState.configured,
  requireSupabaseAdmin: () => ({ rpc: voiceState.rpc }),
  clientIp: () => "203.0.113.10",
  hashIp: (ip: string) => `hashed:${ip}`,
  checkRateLimitDurableDetailed: async () => ({ verdict: false, reason: "counted" }),
}));

import { POST } from "@/app/api/pub-pal/voice-token/route";

const issueRequest = () => new Request("http://localhost/api/pub-pal/voice-token", { method: "POST" });

const releaseRequest = (durationSeconds = 0) =>
  new Request("http://localhost/api/pub-pal/voice-token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "release", durationSeconds }),
  });

function stubProvider(provider: typeof fetch) {
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).includes("/convai/agents/")) {
      return Response.json({ conversation_config: { conversation: { max_duration_seconds: 180 } } });
    }
    return provider(input, init);
  });
}

describe("Pub Pal voice token route", () => {
  beforeEach(() => {
    voiceState.configured = true;
    voiceState.events.length = 0;
    voiceState.palLookupFails = false;
    voiceState.palPresent = true;
    voiceState.pal.muted = false;
    voiceState.pal.hidden = false;
    voiceState.rpc.mockReset();
    voiceState.userId = "11111111-1111-4111-8111-111111111111";
    vi.stubEnv("ELEVENLABS_API_KEY", "server-only-key");
    vi.stubEnv("ELEVENLABS_PUB_PAL_AGENT_ID", "pub-pal-agent");
    vi.stubEnv("ELEVENLABS_VOICE_EMBER", "voice-ember-id");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("returns 503 when ElevenLabs is not configured", async () => {
    vi.stubEnv("ELEVENLABS_API_KEY", "");
    const providerFetch = vi.fn();
    stubProvider(providerFetch);

    const response = await POST(issueRequest());

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ fallback: "text" });
    expect(providerFetch).not.toHaveBeenCalled();
    expect(voiceState.rpc).not.toHaveBeenCalled();
  });

  it("returns 503 when Pal ownership cannot be checked before quota or provider allocation", async () => {
    voiceState.palLookupFails = true;
    const providerFetch = vi.fn();
    stubProvider(providerFetch);

    const response = await POST(issueRequest());

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "PUB_PAL_STORE_UNAVAILABLE" });
    expect(voiceState.rpc).not.toHaveBeenCalled();
    expect(providerFetch).not.toHaveBeenCalled();
  });

  it("requires an owned Pal before quota or provider allocation", async () => {
    voiceState.palPresent = false;
    const providerFetch = vi.fn();
    stubProvider(providerFetch);

    const response = await POST(issueRequest());

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "PUB_PAL_REQUIRED" });
    expect(voiceState.rpc).not.toHaveBeenCalled();
    expect(providerFetch).not.toHaveBeenCalled();
  });

  it("refuses a muted Pal before quota or provider allocation", async () => {
    voiceState.pal.muted = true;
    const providerFetch = vi.fn();
    stubProvider(providerFetch);

    const response = await POST(issueRequest());

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "VOICE_MUTED" });
    expect(voiceState.rpc).not.toHaveBeenCalled();
    expect(providerFetch).not.toHaveBeenCalled();
  });

  it("keeps a directly opened hidden Pal eligible for voice", async () => {
    voiceState.pal.hidden = true;
    voiceState.rpc.mockResolvedValue({ data: true, error: null });
    const providerFetch = vi.fn(async () => Response.json({ signed_url: "wss://voice.example/session" }));
    stubProvider(providerFetch);

    const response = await POST(issueRequest());

    expect(response.status).toBe(200);
    expect(voiceState.rpc).toHaveBeenCalledWith("prepay_pub_pal_voice_grant", expect.any(Object));
    expect(providerFetch).toHaveBeenCalledOnce();
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
    stubProvider(providerFetch);

    const response = await POST(issueRequest());

    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({ remaining: 0, remainingMinutes: 0, fallback: "text" });
    expect(providerFetch).not.toHaveBeenCalled();
    expect(voiceState.events).toEqual(["prepay_pub_pal_voice_grant"]);
  });

  it("does not allocate a provider session when quota reservation errors", async () => {
    voiceState.rpc.mockImplementation(async (name: string) => {
      voiceState.events.push(name);
      throw new Error("quota backend unavailable");
    });
    const providerFetch = vi.fn();
    stubProvider(providerFetch);

    const response = await POST(issueRequest());

    expect(response.status).toBe(503);
    expect(providerFetch).not.toHaveBeenCalled();
    expect(voiceState.events).toEqual(["prepay_pub_pal_voice_grant"]);
  });

  it("releases one reservation when provider allocation fails", async () => {
    voiceState.rpc.mockImplementation(async (name: string) => {
      voiceState.events.push(name);
      return { data: true, error: null };
    });
    stubProvider(vi.fn(async () => {
      voiceState.events.push("provider_allocation");
      return new Response(null, { status: 503 });
    }));

    const response = await POST(issueRequest());

    expect(response.status).toBe(502);
    expect(voiceState.events).toEqual([
      "prepay_pub_pal_voice_grant",
      "provider_allocation",
      "refund_pub_pal_voice_grant",
    ]);
  });

  it("keeps a successful reservation after provider allocation", async () => {
    voiceState.rpc.mockImplementation(async (name: string) => {
      voiceState.events.push(name);
      return { data: true, error: null };
    });
    stubProvider(vi.fn(async () => {
      voiceState.events.push("provider_allocation");
      return Response.json({ signed_url: "wss://voice.example/session" });
    }));

    const response = await POST(issueRequest());

    expect(response.status).toBe(200);
    expect(voiceState.events).toEqual([
      "prepay_pub_pal_voice_grant",
      "provider_allocation",
    ]);
  });

  it("returns overrides, session cap, and pal-derived prompt fields", async () => {
    voiceState.rpc.mockResolvedValue({ data: true, error: null });
    stubProvider(vi.fn(async () => Response.json({ signed_url: "wss://voice.example/session" })));

    const response = await POST(issueRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      signedUrl: "wss://voice.example/session",
      connectionType: "websocket",
      maxSessionSeconds: PAL_VOICE_MAX_SESSION_SECONDS,
      mutationPolicy: "propose_then_confirm",
      retention: "zero",
    });
    expect(body.overrides).toMatchObject({
      voiceId: "voice-ember-id",
      firstMessage: expect.stringContaining("Ripley"),
      systemPrompt: expect.stringMatching(/Getting Home/i),
    });
    expect(body.overrides.systemPrompt).toContain("propose a fact");
    expect(voiceState.rpc).toHaveBeenCalledWith("prepay_pub_pal_voice_grant", {
      p_owner_id: voiceState.userId,
      p_month: expect.stringMatching(/^\d{4}-\d{2}-01$/),
      p_grant_id: expect.stringMatching(/^[a-f0-9-]{36}$/),
    });
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
      if (name === "refund_pub_pal_voice_grant") return release();
      return { data: true, error: null };
    });
    stubProvider(vi.fn(async () => {
      voiceState.events.push("provider_allocation");
      return new Response(null, { status: 503 });
    }));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await POST(issueRequest());

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
    stubProvider(vi.fn(async () => {
      voiceState.events.push("provider_allocation");
      return Response.json({ signed_url: "wss://voice.example/session" });
    }));

    const response = await POST(issueRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ remainingMinutes: PAL_VOICE_MONTHLY_MINUTES - 3 });
    expect(voiceState.rpc).not.toHaveBeenCalled();
  });

  it("releases a keyless in-memory reservation after provider failure", async () => {
    voiceState.configured = false;
    voiceState.userId = "66666666-6666-4666-8666-666666666666";
    const providerFetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(Response.json({ signed_url: "wss://voice.example/session" }));
    stubProvider(providerFetch);

    expect((await POST(issueRequest())).status).toBe(502);
    const recovered = await POST(issueRequest());

    expect(recovered.status).toBe(200);
    expect(await recovered.json()).toMatchObject({ remainingMinutes: PAL_VOICE_MONTHLY_MINUTES - 3 });
    expect(voiceState.rpc).not.toHaveBeenCalled();
  });
  it("does not let a caller release or refund a prepaid grant", async () => {
    voiceState.rpc.mockResolvedValue({ data: true, error: null });
    expect((await POST(releaseRequest(0))).status).toBe(200);
    expect((await POST(releaseRequest(180))).status).toBe(200);
    expect(voiceState.rpc).not.toHaveBeenCalled();
  });
  it("requires a server-side provider cap before handing out a grant", async () => {
    voiceState.rpc.mockResolvedValue({ data: true, error: null });
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ signed_url: "wss://voice.example/session", conversation_config: { conversation: { max_duration_seconds: 3600 } } })));
    const response = await POST(issueRequest());
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "VOICE_CAP_UNVERIFIED" });
  });

  it("bounds ten prepaid grants even when every client reports zero duration", async () => {
    voiceState.configured = false;
    voiceState.userId = "77777777-7777-4777-8777-777777777777";
    const provider = vi.fn(async () => Response.json({ signed_url: "wss://voice.example/session" }));
    stubProvider(provider);
    for (let n = 0; n < 10; n++) {
      expect((await POST(issueRequest())).status).toBe(200);
      expect((await POST(releaseRequest(0))).status).toBe(200);
    }
    expect((await POST(issueRequest())).status).toBe(429);
    expect(provider).toHaveBeenCalledTimes(10);
  });
  it("never uses an in-memory paid allowance in production", async () => {
    voiceState.configured = false;
    vi.stubEnv("NODE_ENV", "production");
    const provider = vi.fn();stubProvider(provider);
    expect((await POST(issueRequest())).status).toBe(503);
    expect(provider).not.toHaveBeenCalled();
  });
  it("binds a failed allocation refund to the unique server grant", async () => {
    voiceState.rpc.mockResolvedValue({ data: true, error: null });
    stubProvider(vi.fn(async () => new Response(null, { status: 503 })));
    expect((await POST(issueRequest())).status).toBe(502);
    const grant = voiceState.rpc.mock.calls.find(([name]) => name === "prepay_pub_pal_voice_grant")?.[1];
    expect(grant.p_grant_id).toMatch(/^[a-f0-9-]{36}$/);
    expect(voiceState.rpc).toHaveBeenCalledWith("refund_pub_pal_voice_grant", {
      p_owner_id: voiceState.userId, p_grant_id: grant.p_grant_id,
    });
  });

});
