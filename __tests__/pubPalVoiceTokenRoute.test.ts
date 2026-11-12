import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { after } from "next/server";
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
  memories: [] as import("@/lib/pubPal").PubPalMemory[],
  palLookupFails: false,
  palPresent: true,
  dateOfBirth: null as string | null,
  identityThrows: false,
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

// Work handed to after() runs once the response is out. Tests run it by hand.
const afterTasks = vi.hoisted(() => [] as Array<() => unknown>);
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: vi.fn((task: unknown) => { afterTasks.push(typeof task === "function" ? task as () => unknown : () => task); }),
}));

async function runAfterTasks(): Promise<void> {
  while (afterTasks.length) await afterTasks.shift()?.();
}

vi.mock("@/lib/authServer", () => ({
  callerUserId: async () => voiceState.userId,
}));

vi.mock("@/lib/pubPalStore", () => ({
  listPalMemoriesResult: async () => ({ ok: true, value: voiceState.memories }),
  getPubPalResult: async () => voiceState.palLookupFails
    ? { ok: false as const, error: "error" as const }
    : { ok: true as const, value: voiceState.palPresent ? voiceState.pal : null },
}));

vi.mock("@/lib/privateIdentityStore", () => ({
  privateIdentityStore: () => ({
    read: async () => {
      if (voiceState.identityThrows) throw new Error("identity store down");
      return voiceState.dateOfBirth ? { dateOfBirth: voiceState.dateOfBirth } : null;
    },
  }),
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
const tasteRead = vi.hoisted(() => vi.fn<
  (ownerId: string) => Promise<import("@/lib/palTaste").PalTaste | null>
>(async () => null));
vi.mock("@/lib/palTaste.server", () => ({ readPalTaste: tasteRead }));

vi.mock("@/lib/pubPalToolTurnStore", () => ({
  bindPubPalToolTurn: voiceBind,
}));

import { POST } from "@/app/api/pub-pal/voice-token/route";
import { buildPalTaste } from "@/lib/palTaste";

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
    tasteRead.mockReset();
    tasteRead.mockResolvedValue(null);
    voiceState.memories = [];
    voiceState.configured = true;
    voiceState.ceilingSpent = false;
    voiceState.events.length = 0;
    voiceState.palLookupFails = false;
    voiceState.palPresent = true;
    voiceState.dateOfBirth = null;
    voiceState.identityThrows = false;
    voiceState.pal.muted = false;
    voiceState.pal.hidden = false;
    voiceState.rpc.mockReset();
    afterTasks.length = 0;
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

  it("refuses a zero lane ceiling before calling the voice provider", async () => {
    vi.stubEnv("PUBMAX_PAID_SPEND_BUDGET_PUB_PAL_VOICE", "0");
    voiceState.configured = false;
    const providerFetch = vi.fn();
    vi.stubGlobal("fetch", providerFetch);
    const response = await POST(issueRequest());
    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({ code: "DAILY_BUDGET_SPENT" });
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

  it("refuses a stored under-18 date of birth before quota or provider allocation", async () => {
    const fourteen = new Date();
    fourteen.setUTCFullYear(fourteen.getUTCFullYear() - 14);
    voiceState.dateOfBirth = fourteen.toISOString().slice(0, 10);
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const response = await POST(issueRequest());

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "PUB_PAL_UNDER_18" });
    expect(voiceState.rpc).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("fails closed when the date of birth cannot be read", async () => {
    voiceState.identityThrows = true;
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const response = await POST(issueRequest());

    expect(response.status).toBe(503);
    expect(voiceState.rpc).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
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
    expect(voiceState.events).toEqual(["prepay_pub_pal_voice_grant", ISSUED, "prepay_pub_pal_voice_grant"]);
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
    expect(voiceState.events).toEqual(["prepay_pub_pal_voice_grant", "refund_pub_pal_voice_grant"]);
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
      "prepay_pub_pal_voice_grant",
      "paid_spend",
      "provider_allocation",
      "link_pub_pal_voice_conversation",
    ]);
  });

  it("reads only the signed-in owner's history for a grounded return greeting", async () => {
    voiceState.rpc.mockResolvedValue({ data: true, error: null });
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ signed_url: SIGNED_URL })));
    tasteRead.mockResolvedValue(buildPalTaste({ diary: [], saved: [],
      drops: [{ venueId: "crown", day: "2026-10-10", drink: "Camden Hells", pintPriceGbp: 5.8, vibeTags: [] }],
      placeOf: () => ({ name: "The Crown", patch: "Soho" }),
    }));
    const response = await POST(new Request("http://localhost/api/pub-pal/voice-token", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ownerId: "another-owner" }),
    }));
    expect(response.status).toBe(200);
    expect(tasteRead).toHaveBeenCalledExactlyOnceWith(voiceState.userId);
    expect((await response.json()).overrides.firstMessage).toContain("The Crown on 10 October 2026, with Camden Hells at £5.80 a pint");
  });

  it("greets a confirmed reported night without a diary visit or inferred bill", async () => {
    voiceState.rpc.mockResolvedValue({ data: true, error: null });
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ signed_url: SIGNED_URL })));
    voiceState.memories = [{ id: "night", palId: voiceState.pal.id, kind: "night_outcome", provenance: "user_confirmed",
      value: "I visited The Crown on 10 October 2026, drank Camden Hells and spent £26.80 in total.",
      createdAt: "2026-10-11T00:00:00Z", updatedAt: "2026-10-11T00:00:00Z" }];
    const response = await POST(issueRequest());
    expect(response.status).toBe(200);
    const greeting = (await response.json()).overrides.firstMessage;
    expect(greeting).toContain("I visited The Crown on 10 October 2026, drank Camden Hells and spent £26.80 in total.");
    expect(greeting).toContain("Something similar");
    expect(greeting).not.toContain("£26.80 a pint");
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

  describe("metering stays exact with settlement off the request path", () => {
    const USER = "11111111-1111-4111-8111-111111111111";
    const EARLIER = "conv_earlierCall01";
    const NEW = CONVERSATION_ID;
    type Grant = { id: string; prepaid: number; state: string; conversationId: string | null };

    /**
     * pub_pal_voice_grants and pub_pal_voice_usage for one owner and month, as
     * migration 0176 defines them: a prepay is admitted while used minutes are
     * under the limit, a refund returns a reserved or issued grant once, and a
     * settle charges the started minutes of the provider's duration (zero
     * seconds is free) in place of the prepayment, once.
     */
    function meteredMonth(usedMinutes: number, earlier: Array<Omit<Grant, "id" | "state" | "prepaid">>) {
      const db = {
        used: usedMinutes,
        grants: earlier.map((grant, index): Grant => ({ ...grant, id: `earlier-${index}`, state: "issued", prepaid: PAL_VOICE_GRANT_MINUTES })),
      };
      voiceState.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => {
        voiceState.events.push(name);
        const grant = (id: unknown) => db.grants.find((row) => row.id === id);
        const byConversation = (id: unknown) => db.grants.find((row) => row.conversationId === id);
        let data: unknown = false;
        if (name === "prepay_pub_pal_voice_grant") {
          if (!grant(args.p_grant_id) && db.used < Number(args.p_limit)) {
            db.used += Number(args.p_minutes);
            db.grants.push({ id: String(args.p_grant_id), prepaid: Number(args.p_minutes), state: "reserved", conversationId: null });
            data = true;
          }
        } else if (name === "refund_pub_pal_voice_grant") {
          const row = grant(args.p_grant_id);
          if (row && (row.state === "reserved" || row.state === "issued")) {
            row.state = "refunded";
            db.used = Math.max(0, db.used - row.prepaid);
            data = true;
          }
        } else if (name === "link_pub_pal_voice_conversation") {
          const row = grant(args.p_grant_id);
          if (row?.state === "reserved") {
            row.state = "issued";
            row.conversationId = String(args.p_conversation_id);
            data = true;
          }
        } else if (name === ISSUED) {
          data = db.grants.filter((row) => row.state === "issued" && row.conversationId).map((row) => row.conversationId);
        } else if (name === OWNS) {
          data = byConversation(args.p_conversation_id)?.state === "issued";
        } else if (name === "settle_pub_pal_voice_conversation") {
          const row = byConversation(args.p_conversation_id);
          if (row?.state === "issued") {
            const seconds = Number(args.p_seconds);
            const charged = seconds === 0 ? 0 : Math.max(1, Math.ceil(seconds / 60));
            db.used = Math.max(0, db.used + charged - row.prepaid);
            row.state = "settled";
            data = true;
          }
        }
        return { data, error: null };
      });
      return db;
    }

    type ProviderCall = { status: string; seconds: number } | "missing" | "silent";

    /** ElevenLabs: a signed URL for the new session, and its record of each earlier call. */
    function provider(calls: Record<string, ProviderCall>) {
      const asked: string[] = [];
      const fetchMock = vi.fn(async (input: URL | string, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("get-signed-url")) {
          voiceState.events.push("provider_allocation");
          return Response.json({ signed_url: SIGNED_URL });
        }
        const id = decodeURIComponent(url.split("/").pop() ?? "");
        asked.push(id);
        const call = calls[id];
        if (call === "missing" || call === undefined) return new Response(null, { status: 404 });
        if (call === "silent") {
          return new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
          });
        }
        return Response.json({ status: call.status, metadata: { call_duration_secs: call.seconds } });
      });
      vi.stubGlobal("fetch", fetchMock);
      return asked;
    }

    beforeEach(() => {
      voiceState.userId = USER;
    });

    it("admits a session without asking the provider about earlier calls, then settles them after the response", async () => {
      const db = meteredMonth(PAL_VOICE_GRANT_MINUTES, [{ conversationId: EARLIER }]);
      const asked = provider({ [EARLIER]: { status: "done", seconds: 20 } });

      const response = await POST(issueRequest());

      expect(response.status).toBe(200);
      expect(asked).toEqual([]);
      expect(db.used).toBe(2 * PAL_VOICE_GRANT_MINUTES);

      await runAfterTasks();

      // The earlier 20-second call costs one minute; the new call is still running and is not asked about.
      expect(asked).toEqual([EARLIER]);
      expect(db.used).toBe(1 + PAL_VOICE_GRANT_MINUTES);
      expect(db.grants.find((grant) => grant.conversationId === NEW)?.state).toBe("issued");
    });

    it("settles earlier calls and admits when the stale charge alone would refuse", async () => {
      const db = meteredMonth(PAL_VOICE_MONTHLY_MINUTES, [{ conversationId: EARLIER }]);
      provider({ [EARLIER]: { status: "done", seconds: 20 } });

      const response = await POST(issueRequest());

      expect(response.status).toBe(200);
      expect(voiceState.events).toEqual([
        "prepay_pub_pal_voice_grant",
        ISSUED,
        "settle_pub_pal_voice_conversation",
        "prepay_pub_pal_voice_grant",
        "paid_spend",
        "provider_allocation",
        "link_pub_pal_voice_conversation",
      ]);
      // As before this change: 30 - 3 + 1 = 28 is under the limit, so the new grant is charged.
      expect(db.used).toBe(PAL_VOICE_MONTHLY_MINUTES - PAL_VOICE_GRANT_MINUTES + 1 + PAL_VOICE_GRANT_MINUTES);
    });

    it.each(["lost reply", "concurrent release"])("admits after a %s hides the settlement result", async (failure) => {
      const db = meteredMonth(PAL_VOICE_MONTHLY_MINUTES, [{ conversationId: EARLIER }]);
      provider({ [EARLIER]: { status: "done", seconds: 20 } });
      const rpc = voiceState.rpc.getMockImplementation()!;
      voiceState.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => {
        if (name === ISSUED && failure === "concurrent release") {
          await rpc("settle_pub_pal_voice_conversation", { p_conversation_id: EARLIER, p_seconds: 20 });
        }
        const result = await rpc(name, args);
        if (name === "settle_pub_pal_voice_conversation" && failure === "lost reply") {
          throw new Error("settlement reply lost");
        }
        return result;
      });

      const response = await POST(issueRequest());

      expect(response.status).toBe(200);
      expect(db.used).toBe(31);
      expect(db.grants.find((grant) => grant.conversationId === EARLIER)?.state).toBe("settled");
      expect(db.grants.find((grant) => grant.conversationId === NEW)?.state).toBe("issued");
    });

    it("keeps the linked grant charged when background scheduling throws", async () => {
      const db = meteredMonth(0, []);
      const asked = provider({});
      await vi.mocked(after).withImplementation(
        () => { throw new Error("no request scope"); },
        async () => {
          await expect(POST(issueRequest())).rejects.toThrow("no request scope");
        },
      );

      expect(db.used).toBe(PAL_VOICE_GRANT_MINUTES);
      expect(db.grants.find((grant) => grant.conversationId === NEW)?.state).toBe("issued");
      expect(asked).toEqual([]);
    });

    it("refuses with the earlier grant still charged when the provider does not answer in time", async () => {
      const db = meteredMonth(PAL_VOICE_MONTHLY_MINUTES, [{ conversationId: EARLIER }]);
      provider({ [EARLIER]: "silent" });

      const { response } = await postOnFakeClock(issueRequest());

      expect(response.status).toBe(429);
      expect(await response.json()).toMatchObject({ code: "VOICE_ALLOWANCE_USED" });
      expect(voiceState.events).toEqual(["prepay_pub_pal_voice_grant", ISSUED, "prepay_pub_pal_voice_grant"]);
      expect(db.used).toBe(PAL_VOICE_MONTHLY_MINUTES);
      expect(db.grants.find((grant) => grant.conversationId === EARLIER)?.state).toBe("issued");
    });

    // Under zero retention mode a 404 cannot tell an unused URL from a finished call whose record is gone.
    it("keeps charging a grant the provider has no record of", async () => {
      const db = meteredMonth(PAL_VOICE_MONTHLY_MINUTES, [{ conversationId: EARLIER }]);
      provider({ [EARLIER]: "missing" });

      const response = await POST(issueRequest());

      expect(response.status).toBe(429);
      expect(voiceState.rpc).not.toHaveBeenCalledWith("settle_pub_pal_voice_conversation", expect.anything());
      expect(db.used).toBe(PAL_VOICE_MONTHLY_MINUTES);
      expect(db.grants.find((grant) => grant.conversationId === EARLIER)?.state).toBe("issued");
    });

    it("keeps charging a call the provider still reports as running", async () => {
      const db = meteredMonth(PAL_VOICE_MONTHLY_MINUTES, [{ conversationId: EARLIER }]);
      provider({ [EARLIER]: { status: "in-progress", seconds: 120 } });

      const response = await POST(issueRequest());

      expect(response.status).toBe(429);
      expect(db.used).toBe(PAL_VOICE_MONTHLY_MINUTES);
    });

    it("leaves every grant charged when the issued grants cannot be listed after the response", async () => {
      const db = meteredMonth(0, []);
      provider({});
      const response = await POST(issueRequest());
      expect(response.status).toBe(200);
      voiceState.rpc.mockImplementation(async (name: string) => {
        voiceState.events.push(name);
        throw new Error("db down");
      });

      await expect(runAfterTasks()).resolves.toBeUndefined();

      expect(db.used).toBe(PAL_VOICE_GRANT_MINUTES);
    });
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
      "prepay_pub_pal_voice_grant",
      "paid_spend",
      "link_pub_pal_voice_conversation",
      "refund_pub_pal_voice_grant",
    ]);
  });
});
