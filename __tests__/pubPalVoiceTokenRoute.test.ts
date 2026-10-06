import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PAL_VOICE_GRANT_MINUTES,
  PAL_VOICE_MAX_SESSION_SECONDS,
  PAL_VOICE_MONTHLY_MINUTES,
} from "@/lib/palVoiceMetering";

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

const CONVERSATION_ID = "conv_voiceToken01";

/** A release as a browser may send it. Any extra field is attacker-controlled. */
const releaseRequest = (body: Record<string, unknown> = { conversationId: CONVERSATION_ID }) =>
  new Request("http://localhost/api/pub-pal/voice-token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "release", ...body }),
  });

const providerCall = (status: string, seconds: number | null) =>
  vi.fn(async () => Response.json({
    status,
    metadata: seconds === null ? {} : { call_duration_secs: seconds },
  }));

const OWNS = "owns_issued_pub_pal_voice_conversation";
const ISSUED = "issued_pub_pal_voice_conversations";

/** One request, with the release's wait for the provider played out on a fake clock. */
async function postOnFakeClock(request: Request): Promise<{ response: Response; elapsedMs: number }> {
  vi.useFakeTimers();
  try {
    const started = Date.now();
    let done = false;
    const pending = POST(request).finally(() => {
      done = true;
    });
    while (!done) await vi.advanceTimersByTimeAsync(250);
    const response = await pending;
    return { response, elapsedMs: Date.now() - started };
  } finally {
    vi.useRealTimers();
  }
}

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
      ISSUED,
      "prepay_pub_pal_voice_grant",
      "paid_spend",
      "refund_pub_pal_voice_grant",
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
      return Response.json({ signed_url: SIGNED_URL });
    });
    vi.stubGlobal("fetch", providerFetch);

    const response = await POST(issueRequest());

    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({ remaining: 0, remainingMinutes: 0, fallback: "text" });
    expect(providerFetch).not.toHaveBeenCalled();
    expect(voiceState.events).toEqual([ISSUED, "prepay_pub_pal_voice_grant"]);
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
    // The reply may have been lost after the database committed, so the grant is
    // refunded; a refund of a grant that was never written moves nothing.
    expect(voiceState.events).toEqual([ISSUED, "prepay_pub_pal_voice_grant", "refund_pub_pal_voice_grant"]);
  });

  it("refunds one grant when provider allocation fails", async () => {
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
      ISSUED,
      "prepay_pub_pal_voice_grant",
      "paid_spend",
      "provider_allocation",
      "refund_pub_pal_voice_grant",
    ]);
  });

  it("keeps a successful grant charged after provider allocation", async () => {
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
      ISSUED,
      "prepay_pub_pal_voice_grant",
      "paid_spend",
      "provider_allocation",
      "link_pub_pal_voice_conversation",
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
    expect(voiceState.rpc).toHaveBeenCalledWith("prepay_pub_pal_voice_grant", {
      p_owner_id: voiceState.userId,
      p_month: expect.stringMatching(/^\d{4}-\d{2}-01$/),
      p_grant_id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      p_minutes: PAL_VOICE_GRANT_MINUTES,
      p_limit: PAL_VOICE_MONTHLY_MINUTES,
    });
    expect(voiceState.rpc).toHaveBeenCalledWith("link_pub_pal_voice_conversation", {
      p_owner_id: voiceState.userId,
      p_grant_id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      p_conversation_id: "conv_voiceToken01",
    });
  });

  it("never settles or refunds from a duration the browser reports", async () => {
    voiceState.rpc.mockImplementation(async (name: string) => {
      voiceState.events.push(name);
      return { data: true, error: null };
    });
    const provider = providerCall("in-progress", 4);
    vi.stubGlobal("fetch", provider);

    for (const durationSeconds of [0, -1, 1, 95, 1e9, "0", null]) {
      const { response } = await postOnFakeClock(releaseRequest({ conversationId: CONVERSATION_ID, durationSeconds }));
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ released: true, settled: false });
    }

    // Only the ownership read ran: the reported duration settled and refunded nothing.
    expect(voiceState.events).toEqual(Array(7).fill(OWNS));
    for (const name of ["refund_pub_pal_voice_grant", "record_pub_pal_voice_minutes", "release_pub_pal_voice_trial"]) {
      expect(voiceState.rpc).not.toHaveBeenCalledWith(name, expect.anything());
    }
  });

  it("settles a finished call from the provider's own duration", async () => {
    voiceState.rpc.mockImplementation(async (name: string) => {
      voiceState.events.push(name);
      return { data: true, error: null };
    });
    const provider = providerCall("done", 41);
    vi.stubGlobal("fetch", provider);

    const response = await POST(releaseRequest({ conversationId: CONVERSATION_ID, durationSeconds: 0 }));

    expect(await response.json()).toMatchObject({ released: true, settled: true });
    expect(provider).toHaveBeenCalledOnce();
    const [url, init] = provider.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`https://api.elevenlabs.io/v1/convai/conversations/${CONVERSATION_ID}`);
    expect(init.headers).toEqual({ "xi-api-key": "server-only-key" });
    expect(voiceState.rpc).toHaveBeenCalledWith("settle_pub_pal_voice_conversation", {
      p_owner_id: voiceState.userId,
      p_conversation_id: CONVERSATION_ID,
      p_seconds: 41,
    });
  });

  it.each([
    { label: "is still running", fetch: () => providerCall("in-progress", 12) },
    { label: "has not started", fetch: () => providerCall("initiated", 0) },
    { label: "carries no duration", fetch: () => providerCall("done", null) },
    { label: "reports a negative duration", fetch: () => providerCall("done", -5) },
    { label: "is refused by the provider", fetch: () => vi.fn(async () => new Response(null, { status: 404 })) },
    { label: "cannot be read", fetch: () => vi.fn(async () => { throw new Error("offline"); }) },
  ])("leaves the prepaid grant charged when the provider call $label", async ({ fetch }) => {
    voiceState.rpc.mockResolvedValue({ data: true, error: null });
    vi.stubGlobal("fetch", fetch());

    const { response, elapsedMs } = await postOnFakeClock(releaseRequest());

    expect(await response.json()).toMatchObject({ released: true, settled: false });
    expect(elapsedMs).toBeLessThanOrEqual(5_000);
    expect(voiceState.rpc).not.toHaveBeenCalledWith("settle_pub_pal_voice_conversation", expect.anything());
  });

  it("settles a call the provider reports ended a moment after the browser hung up", async () => {
    voiceState.rpc.mockResolvedValue({ data: true, error: null });
    const ended = providerCall("done", 20);
    const provider = vi
      .fn()
      .mockImplementationOnce(providerCall("in-progress", 18))
      .mockImplementationOnce(providerCall("in-progress", 19))
      .mockImplementation(ended);
    vi.stubGlobal("fetch", provider);

    const { response } = await postOnFakeClock(releaseRequest());

    expect(await response.json()).toMatchObject({ released: true, settled: true });
    expect(provider).toHaveBeenCalledTimes(3);
    expect(voiceState.rpc).toHaveBeenCalledWith("settle_pub_pal_voice_conversation", {
      p_owner_id: voiceState.userId,
      p_conversation_id: CONVERSATION_ID,
      p_seconds: 20,
    });
  });

  it("stops asking the provider once the settle window closes", async () => {
    voiceState.rpc.mockResolvedValue({ data: true, error: null });
    const provider = providerCall("in-progress", 12);
    vi.stubGlobal("fetch", provider);

    const { response, elapsedMs } = await postOnFakeClock(releaseRequest());

    expect(await response.json()).toMatchObject({ released: true, settled: false });
    expect(provider.mock.calls.length).toBeGreaterThan(1);
    expect(elapsedMs).toBeLessThanOrEqual(5_000);
    expect(voiceState.rpc).not.toHaveBeenCalledWith("settle_pub_pal_voice_conversation", expect.anything());
  });

  it("settles the owner's issued grants from the provider before the allowance check", async () => {
    const earlier = "conv_earlierCall01";
    const running = "conv_stillRunning1";
    voiceState.rpc.mockImplementation(async (name: string) => {
      voiceState.events.push(name);
      return { data: name === ISSUED ? [earlier, running] : true, error: null };
    });
    const provider = vi.fn(async (input: URL | string) => {
      const url = String(input);
      if (url.includes("get-signed-url")) {
        voiceState.events.push("provider_allocation");
        return Response.json({ signed_url: SIGNED_URL });
      }
      return url.endsWith(earlier)
        ? Response.json({ status: "done", metadata: { call_duration_secs: 20 } })
        : Response.json({ status: "in-progress", metadata: { call_duration_secs: 30 } });
    });
    vi.stubGlobal("fetch", provider);

    const response = await POST(issueRequest());

    expect(response.status).toBe(200);
    expect(voiceState.rpc).toHaveBeenCalledWith(ISSUED, {
      p_owner_id: voiceState.userId,
      p_month: expect.stringMatching(/^\d{4}-\d{2}-01$/),
    });
    // The finished call is settled; the one still running stays charged.
    expect(voiceState.events).toEqual([
      ISSUED,
      "settle_pub_pal_voice_conversation",
      "prepay_pub_pal_voice_grant",
      "paid_spend",
      "provider_allocation",
      "link_pub_pal_voice_conversation",
    ]);
    expect(voiceState.rpc).toHaveBeenCalledWith("settle_pub_pal_voice_conversation", {
      p_owner_id: voiceState.userId,
      p_conversation_id: earlier,
      p_seconds: 20,
    });
  });

  it("still admits a session when the issued grants cannot be listed", async () => {
    voiceState.rpc.mockImplementation(async (name: string) => {
      voiceState.events.push(name);
      if (name === ISSUED) throw new Error("db down");
      return { data: true, error: null };
    });
    const provider = vi.fn(async () =>
      Response.json({ signed_url: SIGNED_URL }));
    vi.stubGlobal("fetch", provider);

    const response = await POST(issueRequest());

    expect(response.status).toBe(200);
    expect(provider).toHaveBeenCalledOnce();
    expect(voiceState.events).toEqual([
      ISSUED,
      "prepay_pub_pal_voice_grant",
      "paid_spend",
      "link_pub_pal_voice_conversation",
    ]);
  });

  it("does not call the provider for a conversation id it did not issue", async () => {
    const provider = providerCall("done", 5);
    vi.stubGlobal("fetch", provider);

    for (const conversationId of [undefined, "", "../agents", "conv_a?x=1", "conv_short", 7, { id: 1 }]) {
      const response = await POST(releaseRequest({ conversationId }));
      expect(await response.json()).toMatchObject({ released: true, settled: false });
    }

    expect(provider).not.toHaveBeenCalled();
    expect(voiceState.rpc).not.toHaveBeenCalled();
  });

  it("reports an unsettled release when the settle call fails", async () => {
    vi.stubGlobal("fetch", providerCall("done", 30));
    voiceState.rpc.mockImplementation(async (name: string) =>
      name === OWNS ? { data: true, error: null } : { data: null, error: { message: "db down" } });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await POST(releaseRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ released: true, settled: false });
    expect(consoleError).toHaveBeenCalledTimes(1);
  });

  it.each([
    { label: "holds no issued grant for it", rpc: async () => ({ data: false, error: null }) },
    { label: "cannot be checked", rpc: async () => ({ data: null, error: { message: "db down" } }) },
    { label: "throws on the check", rpc: async () => { throw new Error("db down"); } },
  ])("never asks the provider about a conversation the caller $label", async ({ rpc }) => {
    voiceState.rpc.mockImplementation(rpc);
    const provider = providerCall("done", 5);
    vi.stubGlobal("fetch", provider);

    const response = await POST(releaseRequest({ conversationId: "conv_somebodyElse1" }));

    expect(await response.json()).toMatchObject({ released: true, settled: false });
    expect(voiceState.rpc).toHaveBeenCalledExactlyOnceWith(OWNS, {
      p_owner_id: voiceState.userId,
      p_conversation_id: "conv_somebodyElse1",
    });
    expect(provider).not.toHaveBeenCalled();
  });

  it("keyless: a release settles nothing and moves no meter", async () => {
    voiceState.configured = false;
    voiceState.userId = "77777777-7777-4777-8777-777777777777";
    const provider = providerCall("done", 5);
    vi.stubGlobal("fetch", provider);

    const response = await POST(releaseRequest({ conversationId: CONVERSATION_ID, durationSeconds: 0 }));

    expect(await response.json()).toMatchObject({
      released: true,
      settled: false,
      remainingMinutes: PAL_VOICE_MONTHLY_MINUTES,
    });
    expect(provider).not.toHaveBeenCalled();
    expect(voiceState.rpc).not.toHaveBeenCalled();
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
    expect(await response.json()).toMatchObject({
      remainingMinutes: PAL_VOICE_MONTHLY_MINUTES - PAL_VOICE_GRANT_MINUTES,
    });
    expect(voiceState.rpc).not.toHaveBeenCalled();
  });

  it("refunds a keyless in-memory grant after provider failure", async () => {
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
    // The failed attempt was refunded, so only the second grant is charged.
    expect(await recovered.json()).toMatchObject({
      remainingMinutes: PAL_VOICE_MONTHLY_MINUTES - PAL_VOICE_GRANT_MINUTES,
    });
    expect(voiceState.rpc).not.toHaveBeenCalled();
  });

  it("refunds the grant when the provider URL carries no conversation id", async () => {
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
      ISSUED,
      "prepay_pub_pal_voice_grant",
      "paid_spend",
      "provider_allocation",
      "refund_pub_pal_voice_grant",
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
      ISSUED,
      "prepay_pub_pal_voice_grant",
      "paid_spend",
      "provider_allocation",
      "refund_pub_pal_voice_grant",
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
      ISSUED,
      "prepay_pub_pal_voice_grant",
      "paid_spend",
      "provider_allocation",
      "refund_pub_pal_voice_grant",
    ]);
  });

  it("refunds the grant when the conversation cannot be bound", async () => {
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
    expect(voiceState.events).toContain("refund_pub_pal_voice_grant");
  });

  it("refunds the grant and hands out no URL when the conversation cannot be linked to it", async () => {
    voiceState.rpc.mockImplementation(async (name: string) => {
      voiceState.events.push(name);
      return { data: name === "link_pub_pal_voice_conversation" ? false : true, error: null };
    });
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ signed_url: SIGNED_URL })));

    const response = await POST(issueRequest());
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).not.toHaveProperty("signedUrl");
    expect(voiceState.events).toEqual([
      ISSUED,
      "prepay_pub_pal_voice_grant",
      "paid_spend",
      "link_pub_pal_voice_conversation",
      "refund_pub_pal_voice_grant",
    ]);
  });
});
