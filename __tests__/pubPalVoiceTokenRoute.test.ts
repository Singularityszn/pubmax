import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PAL_VOICE_MAX_SESSION_SECONDS, PAL_VOICE_MONTHLY_MINUTES } from "@/lib/palVoiceMetering";

// The provider's real shape: one `signed_url` field, the id inside its query.
const SIGNED_URL =
  "wss://api.elevenlabs.io/v1/convai/conversation?agent_id=agent_voice&conversation_signature=sig_voice&conversation_id=conv_voiceToken01";
const UNBOUND_SIGNED_URL =
  "wss://api.elevenlabs.io/v1/convai/conversation?agent_id=agent_voice&conversation_signature=sig_voice";

const voiceState = vi.hoisted(() => ({
  configured: true,
  ceilingSpent: false,
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

vi.mock("@/lib/authServer", () => ({
  callerUserId: async () => voiceState.userId,
}));

vi.mock("@/lib/pubPalStore", () => ({
  getPubPalResult: async () => voiceState.palLookupFails
    ? { ok: false as const, error: "error" as const }
    : { ok: true as const, value: voiceState.palPresent ? voiceState.pal : null },
}));

vi.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => voiceState.configured,
  requireSupabaseAdmin: () => ({ rpc: voiceState.rpc }),
  clientIp: () => "203.0.113.10",
  hashIp: (ip: string) => `hashed:${ip}`,
  // The only durable-limiter key the deployment ceiling uses starts `paid-spend:`,
  // and each check of it spends one unit of the ceiling.
  checkRateLimitDurableDetailed: async (key: string) => {
    if (!key.startsWith("paid-spend:")) return { verdict: false, reason: "counted" };
    voiceState.events.push("paid_spend");
    return { verdict: voiceState.ceilingSpent, reason: "counted" };
  },
}));

const voiceBind = vi.hoisted(() => vi.fn(async () => {}));

vi.mock("@/lib/pubPalToolTurnStore", () => ({
  bindPubPalToolTurn: voiceBind,
}));

import { POST } from "@/app/api/pub-pal/voice-token/route";

const issueRequest = () => new Request("http://localhost/api/pub-pal/voice-token", { method: "POST" });

const releaseRequest = (durationSeconds = 0) =>
  new Request("http://localhost/api/pub-pal/voice-token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "release", durationSeconds }),
  });

describe("Pub Pal voice token route", () => {
  beforeEach(() => {
    voiceState.configured = true;
    voiceState.ceilingSpent = false;
    voiceState.events.length = 0;
    voiceState.palLookupFails = false;
    voiceState.palPresent = true;
    voiceState.pal.muted = false;
    voiceState.pal.hidden = false;
    voiceState.rpc.mockReset();
    voiceBind.mockReset();
    voiceBind.mockResolvedValue(undefined);
    voiceState.userId = "11111111-1111-4111-8111-111111111111";
    vi.stubEnv("ELEVENLABS_API_KEY", "server-only-key");
    vi.stubEnv("ELEVENLABS_PUB_PAL_AGENT_ID", "pub-pal-agent");
    vi.stubEnv("ELEVENLABS_VOICE_FOX", "voice-fox-id");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("returns 503 when ElevenLabs is not configured", async () => {
    vi.stubEnv("ELEVENLABS_API_KEY", "");
    const providerFetch = vi.fn();
    vi.stubGlobal("fetch", providerFetch);

    const response = await POST(issueRequest());

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ fallback: "text" });
    expect(providerFetch).not.toHaveBeenCalled();
    expect(voiceState.rpc).not.toHaveBeenCalled();
  });

  it("spends the deployment ceiling after the allowance and hands the reservation back on refusal", async () => {
    voiceState.ceilingSpent = true;
    voiceState.rpc.mockImplementation(async (name: string) => {
      voiceState.events.push(name);
      return { data: true, error: null };
    });
    const providerFetch = vi.fn();
    vi.stubGlobal("fetch", providerFetch);

    const response = await POST(issueRequest());

    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({ code: "DAILY_BUDGET_SPENT", retryable: true });
    expect(providerFetch).not.toHaveBeenCalled();
    expect(voiceState.events).toEqual([
      "consume_pub_pal_voice_trial",
      "paid_spend",
      "release_pub_pal_voice_trial",
    ]);
  });

  it("never spends the deployment ceiling for an account whose allowance is used", async () => {
    voiceState.rpc.mockImplementation(async (name: string) => {
      voiceState.events.push(name);
      return { data: false, error: null };
    });
    vi.stubGlobal("fetch", vi.fn());

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await POST(issueRequest());
      expect(response.status).toBe(429);
      expect(await response.json()).toMatchObject({ code: "VOICE_ALLOWANCE_USED" });
    }

    expect(voiceState.events).not.toContain("paid_spend");
  });

  it("returns 503 when Pal ownership cannot be checked before quota or provider allocation", async () => {
    voiceState.palLookupFails = true;
    const providerFetch = vi.fn();
    vi.stubGlobal("fetch", providerFetch);

    const response = await POST(issueRequest());

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "PUB_PAL_STORE_UNAVAILABLE" });
    expect(voiceState.rpc).not.toHaveBeenCalled();
    expect(providerFetch).not.toHaveBeenCalled();
  });

  it("requires an owned Pal before quota or provider allocation", async () => {
    voiceState.palPresent = false;
    const providerFetch = vi.fn();
    vi.stubGlobal("fetch", providerFetch);

    const response = await POST(issueRequest());

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "PUB_PAL_REQUIRED" });
    expect(voiceState.rpc).not.toHaveBeenCalled();
    expect(providerFetch).not.toHaveBeenCalled();
  });

  it("refuses a muted Pal before quota or provider allocation", async () => {
    voiceState.pal.muted = true;
    const providerFetch = vi.fn();
    vi.stubGlobal("fetch", providerFetch);

    const response = await POST(issueRequest());

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "VOICE_MUTED" });
    expect(voiceState.rpc).not.toHaveBeenCalled();
    expect(providerFetch).not.toHaveBeenCalled();
  });

  it("keeps a directly opened hidden Pal eligible for voice", async () => {
    voiceState.pal.hidden = true;
    voiceState.rpc.mockResolvedValue({ data: true, error: null });
    const providerFetch = vi.fn(async () => Response.json({ signed_url: SIGNED_URL }));
    vi.stubGlobal("fetch", providerFetch);

    const response = await POST(issueRequest());

    expect(response.status).toBe(200);
    expect(voiceState.rpc).toHaveBeenCalledWith("consume_pub_pal_voice_trial", expect.any(Object));
    expect(providerFetch).toHaveBeenCalledOnce();
  });

  it("does not allocate a provider session when quota reservation is refused", async () => {
    voiceState.rpc.mockImplementation(async (name: string) => {
      voiceState.events.push(name);
      return { data: false, error: null };
    });
    const providerFetch = vi.fn(async () => {
      voiceState.events.push("provider_allocation");
      return Response.json({ signed_url: SIGNED_URL });
    });
    vi.stubGlobal("fetch", providerFetch);

    const response = await POST(issueRequest());

    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({ remaining: 0, remainingMinutes: 0, fallback: "text" });
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

    const response = await POST(issueRequest());

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

    const response = await POST(issueRequest());

    expect(response.status).toBe(502);
    expect(voiceState.events).toEqual([
      "consume_pub_pal_voice_trial",
      "paid_spend",
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
      return Response.json({ signed_url: SIGNED_URL });
    }));

    const response = await POST(issueRequest());

    expect(response.status).toBe(200);
    expect(voiceState.events).toEqual([
      "consume_pub_pal_voice_trial",
      "paid_spend",
      "provider_allocation",
    ]);
  });

  it("returns overrides, session cap, and pal-derived prompt fields", async () => {
    voiceState.rpc.mockResolvedValue({ data: true, error: null });
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ signed_url: SIGNED_URL })));

    const response = await POST(issueRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      signedUrl: SIGNED_URL,
      connectionType: "websocket",
      maxSessionSeconds: PAL_VOICE_MAX_SESSION_SECONDS,
      mutationPolicy: "propose_then_confirm",
      retention: "provider_default",
    });
    expect(body.conversationId).toBe("conv_voiceToken01");
    expect(body.overrides).toMatchObject({
      voiceId: "voice-fox-id",
      firstMessage: expect.stringContaining("Ripley"),
    });
    expect(body.overrides).not.toHaveProperty("systemPrompt");
    expect(body.overrides).not.toHaveProperty("dynamicVariables");
    expect(JSON.stringify(body)).not.toContain("Getting Home");
    expect(voiceBind).toHaveBeenCalledWith("conv_voiceToken01", voiceState.userId, "london");
    expect(voiceState.rpc).toHaveBeenCalledWith("consume_pub_pal_voice_trial", {
      p_owner_id: voiceState.userId,
      p_month: expect.stringMatching(/^\d{4}-\d{2}-01$/),
      p_limit: PAL_VOICE_MONTHLY_MINUTES,
    });
  });

  it("releases a client-failed session without billing minutes", async () => {
    voiceState.rpc.mockImplementation(async (name: string) => {
      voiceState.events.push(name);
      return { data: true, error: null };
    });

    const response = await POST(releaseRequest(0));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ released: true });
    expect(voiceState.events).toEqual(["release_pub_pal_voice_trial"]);
  });

  it("records billed minutes when the client releases after a live session", async () => {
    voiceState.rpc.mockImplementation(async (name: string) => {
      voiceState.events.push(name);
      return { data: true, error: null };
    });

    const response = await POST(releaseRequest(95));

    expect(response.status).toBe(200);
    expect(voiceState.events).toEqual([
      "release_pub_pal_voice_trial",
      "record_pub_pal_voice_minutes",
    ]);
    expect(voiceState.rpc).toHaveBeenCalledWith("record_pub_pal_voice_minutes", {
      p_owner_id: voiceState.userId,
      p_month: expect.stringMatching(/^\d{4}-\d{2}-01$/),
      p_seconds: 95,
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
      if (name === "release_pub_pal_voice_trial") return release();
      return { data: true, error: null };
    });
    vi.stubGlobal("fetch", vi.fn(async () => {
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
    vi.stubGlobal("fetch", vi.fn(async () => {
      voiceState.events.push("provider_allocation");
      return Response.json({ signed_url: SIGNED_URL });
    }));

    const response = await POST(issueRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ remainingMinutes: PAL_VOICE_MONTHLY_MINUTES });
    expect(voiceState.rpc).not.toHaveBeenCalled();
  });

  it("releases a keyless in-memory reservation after provider failure", async () => {
    voiceState.configured = false;
    voiceState.userId = "66666666-6666-4666-8666-666666666666";
    const providerFetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(Response.json({ signed_url: SIGNED_URL }));
    vi.stubGlobal("fetch", providerFetch);

    expect((await POST(issueRequest())).status).toBe(502);
    const recovered = await POST(issueRequest());

    expect(recovered.status).toBe(200);
    expect(await recovered.json()).toMatchObject({ remainingMinutes: PAL_VOICE_MONTHLY_MINUTES });
    expect(voiceState.rpc).not.toHaveBeenCalled();
  });

  it("releases the reservation when the provider URL carries no conversation id", async () => {
    voiceState.rpc.mockImplementation(async (name: string) => {
      voiceState.events.push(name);
      return { data: true, error: null };
    });
    vi.stubGlobal("fetch", vi.fn(async () => {
      voiceState.events.push("provider_allocation");
      return Response.json({ signed_url: UNBOUND_SIGNED_URL });
    }));

    const response = await POST(issueRequest());

    expect(response.status).toBe(502);
    expect(voiceBind).not.toHaveBeenCalled();
    expect(voiceState.events).toEqual([
      "consume_pub_pal_voice_trial",
      "paid_spend",
      "provider_allocation",
      "release_pub_pal_voice_trial",
    ]);
  });

  it("reports a provider reply that is not JSON as no session, not a timeout", async () => {
    voiceState.rpc.mockImplementation(async (name: string) => {
      voiceState.events.push(name);
      return { data: true, error: null };
    });
    vi.stubGlobal("fetch", vi.fn(async () => {
      voiceState.events.push("provider_allocation");
      return new Response("<html>gateway</html>", { status: 200, headers: { "Content-Type": "text/html" } });
    }));

    const response = await POST(issueRequest());

    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({
      code: "PROVIDER_UNAVAILABLE",
      error: "Voice service returned no session.",
    });
    expect(voiceState.events).toEqual([
      "consume_pub_pal_voice_trial",
      "provider_allocation",
      "release_pub_pal_voice_trial",
    ]);
  });

  it("reports a provider that cannot be reached as a timeout", async () => {
    voiceState.rpc.mockImplementation(async (name: string) => {
      voiceState.events.push(name);
      return { data: true, error: null };
    });
    vi.stubGlobal("fetch", vi.fn(async () => {
      voiceState.events.push("provider_allocation");
      throw new TypeError("fetch failed");
    }));

    const response = await POST(issueRequest());

    expect(response.status).toBe(504);
    expect(await response.json()).toMatchObject({ code: "PROVIDER_TIMEOUT" });
    expect(voiceState.events).toEqual([
      "consume_pub_pal_voice_trial",
      "provider_allocation",
      "release_pub_pal_voice_trial",
    ]);
  });

  it("releases the reservation when the conversation cannot be bound", async () => {
    voiceState.rpc.mockImplementation(async (name: string) => {
      voiceState.events.push(name);
      return { data: true, error: null };
    });
    voiceBind.mockRejectedValue(new Error("schema missing"));
    vi.stubGlobal("fetch", vi.fn(async () => {
      voiceState.events.push("provider_allocation");
      return Response.json({ signed_url: SIGNED_URL });
    }));

    const response = await POST(issueRequest());

    expect(response.status).toBe(503);
    expect(voiceState.events).toContain("release_pub_pal_voice_trial");
  });
});
