import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authState = vi.hoisted(() => ({ ownerId: null as string | null }));

vi.mock("@/lib/authServer", () => ({
  callerUserId: async () => authState.ownerId,
}));

vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return {
    ...actual,
    isSupabaseConfigured: () => false,
    requiresSupabaseStore: () => false,
    requireSupabaseAdmin: () => {
      throw new Error("Route preference tests use the real memory stores only.");
    },
    clientIp: () => "203.0.113.44",
    hashIp: (ip: string) => `hashed:${ip}`,
  };
});

vi.mock("@/lib/pintDrops", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/pintDrops")>();
  return { ...actual, isLimited: vi.fn(async () => false) };
});

vi.mock("@/lib/ai/typesafe.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/typesafe.server")>();
  return { ...actual, systemOne: vi.fn(async () => null) };
});

// Configured HTTP projection receives a controlled grounded service outcome.
// Keyless chat, public Ask, webhook routing, handlers and both stores stay real.
vi.mock("@/lib/palElevenLabsChat.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/palElevenLabsChat.server")>();
  return { ...actual, runPalElevenLabsChatTurn: vi.fn() };
});

import { POST as chatPost } from "@/app/api/pub-pal/chat/route";
import { POST as askPost } from "@/app/api/ask/route";
import { POST as toolPost } from "@/app/api/pub-pal/tools/[toolName]/route";
import { offlineFetch } from "@/evals/pal/offlineFetch";
import { runAsk } from "@/lib/ask/runAsk";
import { runPalElevenLabsChatTurn } from "@/lib/palElevenLabsChat.server";
import { DEFAULT_PAL_DRAFT } from "@/lib/pubPal";
import {
  __resetPubPalStore,
  createPubPalResult,
  updatePubPalResult,
} from "@/lib/pubPalStore";
import {
  __resetPubPalToolTurnStore,
  readOwnedPubPalToolTurn,
  registerPubPalToolTurn,
} from "@/lib/pubPalToolTurnStore";

const OWNER_A = "11111111-1111-4111-8111-111111111111";
const OWNER_B = "22222222-2222-4222-8222-222222222222";
const CONVERSATION_ID = "conv_routepreferences01";
const CRAWL_QUERY = "Plan a crawl in Soho for 4";
const WEBHOOK_SECRET = "test-only-route-preference-webhook-secret";

async function savePreference(ownerId: string, routes: boolean): Promise<void> {
  const created = await createPubPalResult(ownerId, {
    ...DEFAULT_PAL_DRAFT,
    adultConfirmed: true,
    name: "Morrow",
    proposalPreferences: { memories: false, routes },
  });
  if (!created.ok) throw new Error("Synthetic owned Pal fixture could not be created.");
  expect(created.value.ownerId).toBe(ownerId);
  expect(created.value.proposalPreferences.routes).toBe(routes);
}

function chatRequest(extra: Record<string, unknown> = {}): Request {
  return new Request("http://localhost/api/pub-pal/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: CRAWL_QUERY, cityId: "london", ...extra }),
  });
}

function assertGroundedDraft(body: Record<string, unknown>): void {
  expect(Array.isArray(body.proposals)).toBe(true);
  const proposals = body.proposals as Array<Record<string, unknown>>;
  const draft = proposals.find((proposal) => proposal.kind === "draft_plan");
  expect(draft).toMatchObject({ kind: "draft_plan", label: "Open in Plan" });
  expect(draft?.stopIds).toHaveLength(3);
  expect(new Set(draft?.stopIds as string[]).size).toBe(3);
  expect(body.cards).toEqual(expect.arrayContaining([
    expect.objectContaining({ venueId: expect.any(String), title: expect.any(String) }),
  ]));
}

function assertRouteOff(body: Record<string, unknown>, answerField = "answer"): void {
  expect(Array.isArray(body.proposals)).toBe(true);
  expect(body.proposals).not.toEqual(expect.arrayContaining([
    expect.objectContaining({ kind: "draft_plan" }),
  ]));
  expect(body[answerField]).toEqual(expect.stringMatching(/route proposals.*(?:off|disabled|turned off)/i));
  expect(body[answerField]).not.toEqual(expect.stringMatching(/proposed draft:|open in plan/i));
}

async function ownedWebhook(extra: Record<string, unknown> = {}): Promise<Response> {
  return toolPost(new Request("http://localhost/api/pub-pal/tools/propose_plan", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${WEBHOOK_SECRET}`,
    },
    body: JSON.stringify({
      conversation_id: CONVERSATION_ID,
      parameters: { query: CRAWL_QUERY, cityId: "london", ...extra },
    }),
  }), { params: Promise.resolve({ toolName: "propose_plan" }) });
}

async function bindOwnedAsk(ownerId: string): Promise<void> {
  await registerPubPalToolTurn(CONVERSATION_ID, {
    ownerId, query: CRAWL_QUERY, cityId: "london",
    turns: [{ role: "user", content: CRAWL_QUERY }],
  });
}

describe("Pub Pal saved route proposal preference", () => {
  beforeEach(() => {
    __resetPubPalStore();
    __resetPubPalToolTurnStore();
    authState.ownerId = OWNER_A;
    vi.stubEnv("ELEVENLABS_API_KEY", "");
    vi.stubEnv("ELEVENLABS_PUB_PAL_AGENT_ID", "");
    vi.stubEnv("ELEVENLABS_LLM_SHARED_SECRET", WEBHOOK_SECRET);
    vi.stubEnv("OPENROUTER_API_KEY", "");
    vi.stubEnv("PUBMAX_PAID_SPEND_BUDGET_ASK", "");
    vi.stubEnv("PUBMAX_PAID_SPEND_BUDGET_PUB_PAL_CHAT", "");
    vi.stubGlobal("fetch", offlineFetch);
    vi.mocked(runPalElevenLabsChatTurn).mockReset();
    vi.mocked(runPalElevenLabsChatTurn).mockImplementation(async (input) => {
      const grounded = await runAsk({
        query: input.query, cityId: input.cityId, skipModel: true,
      });
      return {
        ok: true, message: grounded.answer, cards: grounded.cards,
        proposals: grounded.proposals, toolsUsed: grounded.toolsUsed,
        conversationId: CONVERSATION_ID,
      };
    });
  });

  afterEach(() => {
    __resetPubPalStore();
    __resetPubPalToolTurnStore();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("blocks an explicitly requested keyless Pal crawl when its saved route preference is off", async () => {
    await savePreference(OWNER_A, false);
    const response = await chatPost(chatRequest());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    assertRouteOff(await response.json());
    expect(runPalElevenLabsChatTurn).not.toHaveBeenCalled();
  });

  it("preserves a grounded explicitly requested keyless Pal crawl when route proposals are on", async () => {
    await savePreference(OWNER_A, true);
    const response = await chatPost(chatRequest());
    expect(response.status).toBe(200);
    assertGroundedDraft(await response.json());
  });

  it("does not let browser route-on or another owner override its saved keyless route-off preference", async () => {
    await savePreference(OWNER_A, false);
    await savePreference(OWNER_B, true);
    const response = await chatPost(chatRequest({
      ownerId: OWNER_B, proposalPreferences: { routes: true },
    }));
    expect(response.status).toBe(200);
    assertRouteOff(await response.json());
  });

  it("uses the current caller's own route-on preference after another account saved route-off", async () => {
    await savePreference(OWNER_A, false);
    await savePreference(OWNER_B, true);
    authState.ownerId = OWNER_B;
    const response = await chatPost(chatRequest());
    expect(response.status).toBe(200);
    assertGroundedDraft(await response.json());
  });

  it("does not borrow an account's route-off preference for an anonymous keyless ask", async () => {
    await savePreference(OWNER_A, false);
    authState.ownerId = null;
    const response = await chatPost(chatRequest());
    expect(response.status).toBe(200);
    assertGroundedDraft(await response.json());
  });

  it("keeps public Map Ask crawl proposals available when the caller's Pal preference is off", async () => {
    await savePreference(OWNER_A, false);
    const response = await askPost(new Request("http://localhost/api/ask", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: CRAWL_QUERY, cityId: "london" }),
    }));
    expect(response.status).toBe(200);
    assertGroundedDraft(await response.json());
  });

  it("prevents configured typed draft projection when the caller's saved route preference is off", async () => {
    await savePreference(OWNER_A, false);
    vi.stubEnv("ELEVENLABS_API_KEY", "test-only-configured-provider-key");
    vi.stubEnv("ELEVENLABS_PUB_PAL_AGENT_ID", "test-only-agent");
    const response = await chatPost(chatRequest());
    expect(response.status).toBe(200);
    assertRouteOff(await response.json());
  });

  it("preserves configured typed grounded draft projection when the caller's route preference is on", async () => {
    await savePreference(OWNER_A, true);
    vi.stubEnv("ELEVENLABS_API_KEY", "test-only-configured-provider-key");
    vi.stubEnv("ELEVENLABS_PUB_PAL_AGENT_ID", "test-only-agent");
    const response = await chatPost(chatRequest());
    expect(response.status).toBe(200);
    assertGroundedDraft(await response.json());
  });

  it("blocks the owned voice webhook's explicit crawl and stores honest refusal when routes are off", async () => {
    await savePreference(OWNER_A, false);
    await bindOwnedAsk(OWNER_A);
    const response = await ownedWebhook();
    expect(response.status).toBe(200);
    const body = await response.json();
    assertRouteOff(body.result, "answerHint");
    const stored = await readOwnedPubPalToolTurn(CONVERSATION_ID, OWNER_A);
    expect(stored).not.toBeNull();
    expect(stored?.proposals).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "draft_plan" }),
    ]));
    expect(stored?.hints).toEqual(expect.arrayContaining([
      expect.stringMatching(/route proposals.*(?:off|disabled|turned off)/i),
    ]));
  });

  it("preserves the owned voice webhook's grounded crawl when routes are on", async () => {
    await savePreference(OWNER_A, true);
    await bindOwnedAsk(OWNER_A);
    const response = await ownedWebhook();
    expect(response.status).toBe(200);
    assertGroundedDraft((await response.json()).result);
  });

  it("resolves voice preference from the captured conversation owner rather than browser owner hints", async () => {
    await savePreference(OWNER_A, false);
    await savePreference(OWNER_B, true);
    await bindOwnedAsk(OWNER_A);
    authState.ownerId = OWNER_B;
    const response = await ownedWebhook({
      ownerId: OWNER_B, proposalPreferences: { routes: true },
    });
    expect(response.status).toBe(200);
    assertRouteOff((await response.json()).result, "answerHint");
  });

  it("fails closed for a voice crawl whose conversation owner no longer resolves", async () => {
    await savePreference(OWNER_A, false);
    const response = await ownedWebhook();
    expect(response.status).toBe(200);
    assertRouteOff((await response.json()).result, "answerHint");
    expect(await readOwnedPubPalToolTurn(CONVERSATION_ID, OWNER_A)).toBeNull();
  });

  it("uses a newly saved route-off preference during an already owned voice conversation", async () => {
    await savePreference(OWNER_A, true);
    await bindOwnedAsk(OWNER_A);
    const changed = await updatePubPalResult(OWNER_A, {
      proposalPreferences: { memories: false, routes: false },
    });
    expect(changed).toMatchObject({ ok: true, value: { proposalPreferences: { routes: false } } });
    const response = await ownedWebhook();
    expect(response.status).toBe(200);
    assertRouteOff((await response.json()).result, "answerHint");
  });
});


// Additional controls use the real memory stores. Failure cases alone spy on
// the canonical settings-read boundary; held tool work still runs its handler.
describe("Pub Pal route preference projection and availability", () => {
  beforeEach(() => {
    __resetPubPalStore();
    __resetPubPalToolTurnStore();
    authState.ownerId = OWNER_A;
    vi.stubEnv("ELEVENLABS_API_KEY", "");
    vi.stubEnv("ELEVENLABS_PUB_PAL_AGENT_ID", "");
    vi.stubEnv("ELEVENLABS_LLM_SHARED_SECRET", WEBHOOK_SECRET);
    vi.stubEnv("OPENROUTER_API_KEY", "");
    vi.stubEnv("PUBMAX_PAID_SPEND_BUDGET_ASK", "");
    vi.stubEnv("PUBMAX_PAID_SPEND_BUDGET_PUB_PAL_CHAT", "");
    vi.stubGlobal("fetch", offlineFetch);
    vi.mocked(runPalElevenLabsChatTurn).mockReset();
    vi.mocked(runPalElevenLabsChatTurn).mockImplementation(async (input) => {
      const grounded = await runAsk({
        query: input.query, cityId: input.cityId, skipModel: true,
      });
      return {
        ok: true, message: grounded.answer, cards: grounded.cards,
        proposals: grounded.proposals, toolsUsed: grounded.toolsUsed,
        conversationId: CONVERSATION_ID,
      };
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    __resetPubPalStore();
    __resetPubPalToolTurnStore();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("keeps grounded price answers and venue-opening controls available while routes are off", async () => {
    await savePreference(OWNER_A, false);
    const price = await chatPost(chatRequest({ query: "Cheapest pint in Camden tonight" }));
    expect(price.status).toBe(200);
    const priceBody = await price.json();
    expect(priceBody.toolsUsed).toContain("cheapest_pint_near");
    expect(priceBody.cards.length).toBeGreaterThan(0);
    expect(priceBody.answer).toMatch(/Cheapest listed pints in Camden/i);
    const opening = await chatPost(chatRequest({ query: "Open The Lamb" }));
    expect(opening.status).toBe(200);
    const openingBody = await opening.json();
    expect(openingBody.proposals).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "open_venue", venueId: expect.any(String) }),
    ]));
    expect(openingBody.answer).not.toMatch(/route proposals.*off/i);
  });

  it("preserves configured venue-opening output and does not require an owned Pal when none exists", async () => {
    const missingPal = await chatPost(chatRequest());
    expect(missingPal.status).toBe(200);
    assertGroundedDraft(await missingPal.json());
    await savePreference(OWNER_A, false);
    vi.stubEnv("ELEVENLABS_API_KEY", "test-only-configured-provider-key");
    vi.stubEnv("ELEVENLABS_PUB_PAL_AGENT_ID", "test-only-agent");
    const opening = await chatPost(chatRequest({ query: "Open The Lamb" }));
    expect(opening.status).toBe(200);
    expect((await opening.json()).proposals).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "open_venue", venueId: expect.any(String) }),
    ]));
    expect(runPalElevenLabsChatTurn).toHaveBeenCalledTimes(1);
  });

  it("keeps the owned voice get-home fence ahead of route preference refusal", async () => {
    await savePreference(OWNER_A, false);
    const query = "How do I get home safely?";
    await registerPubPalToolTurn(CONVERSATION_ID, {
      ownerId: OWNER_A, query, cityId: "london", turns: [{ role: "user", content: query }],
    });
    const response = await ownedWebhook({ query });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.result).toMatchObject({ ok: true, fenced: true, cards: [], proposals: [] });
    expect(body.result.answerHint).toMatch(/Getting Home/);
    expect(body.result.answerHint).not.toMatch(/route proposals.*off/i);
  });

  it("returns the saved-off refusal before a closed provider spend budget", async () => {
    await savePreference(OWNER_A, false);
    vi.stubEnv("ELEVENLABS_API_KEY", "test-only-configured-provider-key");
    vi.stubEnv("ELEVENLABS_PUB_PAL_AGENT_ID", "test-only-agent");
    vi.stubEnv("PUBMAX_PAID_SPEND_BUDGET_PUB_PAL_CHAT", "0");
    const response = await chatPost(chatRequest());
    expect(response.status).toBe(200);
    assertRouteOff(await response.json());
    expect(runPalElevenLabsChatTurn).not.toHaveBeenCalled();
  });

  it("applies a saved-off change made while a configured typed route outcome is in flight", async () => {
    await savePreference(OWNER_A, true);
    vi.stubEnv("ELEVENLABS_API_KEY", "test-only-configured-provider-key");
    vi.stubEnv("ELEVENLABS_PUB_PAL_AGENT_ID", "test-only-agent");
    const grounded = await runAsk({ query: CRAWL_QUERY, cityId: "london", skipModel: true });
    assertGroundedDraft(grounded as unknown as Record<string, unknown>);
    let entered!: () => void;
    let release!: () => void;
    const providerEntered = new Promise<void>((resolve) => { entered = resolve; });
    const providerRelease = new Promise<void>((resolve) => { release = resolve; });
    vi.mocked(runPalElevenLabsChatTurn).mockImplementationOnce(async () => {
      entered();
      await providerRelease;
      return {
        ok: true, message: grounded.answer, cards: grounded.cards,
        proposals: grounded.proposals, toolsUsed: grounded.toolsUsed,
        conversationId: CONVERSATION_ID,
      };
    });
    const pending = chatPost(chatRequest({ query: "Find pubs in Soho" }));
    await providerEntered;
    try {
      expect(await updatePubPalResult(OWNER_A, {
        proposalPreferences: { memories: false, routes: false },
      })).toMatchObject({ ok: true, value: { proposalPreferences: { routes: false } } });
    } finally {
      release();
    }
    const response = await pending;
    expect(response.status).toBe(200);
    const body = await response.json();
    assertRouteOff(body);
    expect(body.cards).toEqual([]);
    expect(body.sources).toEqual([]);
  });

  it("does not project old stored route-on draft cards or hints while the current setting is off", async () => {
    await savePreference(OWNER_A, true);
    await bindOwnedAsk(OWNER_A);
    const original = await ownedWebhook();
    expect(original.status).toBe(200);
    assertGroundedDraft((await original.json()).result);
    const originalTurn = await readOwnedPubPalToolTurn(CONVERSATION_ID, OWNER_A);
    expect(originalTurn?.hints).toEqual(expect.arrayContaining([
      expect.stringMatching(/proposed draft:.*open in plan/i),
    ]));
    expect(await updatePubPalResult(OWNER_A, {
      proposalPreferences: { memories: false, routes: false },
    })).toMatchObject({ ok: true });
    vi.stubEnv("ELEVENLABS_API_KEY", "test-only-configured-provider-key");
    vi.stubEnv("ELEVENLABS_PUB_PAL_AGENT_ID", "test-only-agent");
    vi.mocked(runPalElevenLabsChatTurn).mockImplementationOnce(async () => {
      const stored = await readOwnedPubPalToolTurn(CONVERSATION_ID, OWNER_A);
      if (!stored) throw new Error("Expected synthetic owned route receipt.");
      return {
        ok: true, message: stored.hints.join(" "), cards: stored.cards,
        proposals: stored.proposals, toolsUsed: stored.toolsUsed,
        conversationId: CONVERSATION_ID,
      };
    });
    const response = await chatPost(chatRequest({ query: "Show my last result" }));
    expect(response.status).toBe(200);
    const body = await response.json();
    assertRouteOff(body);
    expect(body.cards).toEqual([]);
    expect(await readOwnedPubPalToolTurn(CONVERSATION_ID, OWNER_A)).toEqual(originalTurn);
  });

  it("refuses a newly computed voice route when its captured owner's setting changes before append", async () => {
    await savePreference(OWNER_A, true);
    await bindOwnedAsk(OWNER_A);
    const tools = await import("@/lib/ask/tools");
    const realRunAskTool = tools.runAskTool;
    let entered!: () => void;
    let release!: () => void;
    const toolEntered = new Promise<void>((resolve) => { entered = resolve; });
    const toolRelease = new Promise<void>((resolve) => { release = resolve; });
    vi.spyOn(tools, "runAskTool").mockImplementationOnce(async (...args) => {
      const result = await realRunAskTool(...args);
      expect(result.proposals).toEqual(expect.arrayContaining([
        expect.objectContaining({ kind: "draft_plan" }),
      ]));
      entered();
      await toolRelease;
      return result;
    });
    const pending = ownedWebhook();
    await toolEntered;
    try {
      expect(await updatePubPalResult(OWNER_A, {
        proposalPreferences: { memories: false, routes: false },
      })).toMatchObject({ ok: true });
    } finally {
      release();
    }
    const response = await pending;
    expect(response.status).toBe(200);
    assertRouteOff((await response.json()).result, "answerHint");
    const stored = await readOwnedPubPalToolTurn(CONVERSATION_ID, OWNER_A);
    expect(stored?.cards).toEqual([]);
    expect(stored?.proposals).toEqual([]);
    expect(stored?.hints).toEqual([
      expect.stringMatching(/route proposals.*off/i),
    ]);
  });

  it.each(["structured", "throw"] as const)(
    "returns retryable typed 503 on a %s canonical preference-read failure before provider spend",
    async (failure) => {
      await savePreference(OWNER_A, true);
      const store = await import("@/lib/pubPalStore");
      const read = vi.spyOn(store, "getPubPalResult");
      if (failure === "structured") read.mockResolvedValue({ ok: false, error: "error" });
      else read.mockRejectedValue(new Error("Synthetic settings transport failure."));
      for (const configured of [false, true]) {
        vi.stubEnv("ELEVENLABS_API_KEY", configured ? "test-only-configured-provider-key" : "");
        vi.stubEnv("ELEVENLABS_PUB_PAL_AGENT_ID", configured ? "test-only-agent" : "");
        vi.stubEnv("PUBMAX_PAID_SPEND_BUDGET_PUB_PAL_CHAT", "0");
        const response = await chatPost(chatRequest());
        expect(response.status).toBe(503);
        expect(response.headers.get("cache-control")).toBe("no-store");
        const body = await response.json();
        expect(body).toMatchObject({ code: "UNAVAILABLE", retryable: true, error: expect.any(String) });
        expect(body.error).not.toMatch(/route proposals.*off|proposed draft:|open in plan/i);
        expect(body.proposals).toBeUndefined();
      }
      expect(runPalElevenLabsChatTurn).not.toHaveBeenCalled();
    },
  );

  it.each(["structured", "throw"] as const)(
    "returns retryable voice 503 on a %s canonical preference-read failure without appending route output",
    async (failure) => {
      await savePreference(OWNER_A, true);
      await bindOwnedAsk(OWNER_A);
      const before = await readOwnedPubPalToolTurn(CONVERSATION_ID, OWNER_A);
      const store = await import("@/lib/pubPalStore");
      const read = vi.spyOn(store, "getPubPalResult");
      if (failure === "structured") read.mockResolvedValue({ ok: false, error: "error" });
      else read.mockRejectedValue(new Error("Synthetic settings transport failure."));
      const response = await ownedWebhook();
      expect(response.status).toBe(503);
      expect(response.headers.get("cache-control")).toBe("no-store");
      const body = await response.json();
      expect(body).toMatchObject({ code: "UNAVAILABLE", retryable: true, error: expect.any(String) });
      expect(body.error).not.toMatch(/route proposals.*off|proposed draft:|open in plan/i);
      expect(body.result).toBeUndefined();
      expect(await readOwnedPubPalToolTurn(CONVERSATION_ID, OWNER_A)).toEqual(before);
    },
  );
});


describe("Pub Pal voice receipt write conflict", () => {
  beforeEach(() => {
    __resetPubPalStore();
    __resetPubPalToolTurnStore();
    vi.stubEnv("ELEVENLABS_LLM_SHARED_SECRET", WEBHOOK_SECRET);
    vi.stubEnv("OPENROUTER_API_KEY", "");
    vi.stubGlobal("fetch", offlineFetch);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    __resetPubPalStore();
    __resetPubPalToolTurnStore();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("answers a typed retryable conflict instead of an unpersisted crawl", async () => {
    await savePreference(OWNER_A, true);
    await bindOwnedAsk(OWNER_A);
    const before = await readOwnedPubPalToolTurn(CONVERSATION_ID, OWNER_A);
    const store = await import("@/lib/pubPalToolTurnStore");
    vi.spyOn(store, "appendPubPalToolTurn").mockRejectedValue(new store.PubPalToolTurnWriteConflictError());
    const response = await ownedWebhook();
    expect(response.status).toBe(409);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(body).toMatchObject({ code: "CONFLICT", retryable: true, error: expect.any(String) });
    expect(body.result).toBeUndefined();
    expect(await readOwnedPubPalToolTurn(CONVERSATION_ID, OWNER_A)).toEqual(before);
  });
});


// A failed settings read must not turn unrelated questions into an outage.
describe("Pub Pal nonroute asks during a route-settings outage", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    __resetPubPalStore();
    __resetPubPalToolTurnStore();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it.each([false, true])(
    "preserves grounded price and get-home answers without reading route preferences (configured: %s)",
    async (configured) => {
      __resetPubPalStore();
      __resetPubPalToolTurnStore();
      authState.ownerId = OWNER_A;
      vi.stubEnv("ELEVENLABS_API_KEY", configured ? "test-only-configured-provider-key" : "");
      vi.stubEnv("ELEVENLABS_PUB_PAL_AGENT_ID", configured ? "test-only-agent" : "");
      vi.stubEnv("OPENROUTER_API_KEY", "");
      vi.stubEnv("PUBMAX_PAID_SPEND_BUDGET_ASK", "");
      vi.stubEnv("PUBMAX_PAID_SPEND_BUDGET_PUB_PAL_CHAT", "");
      vi.stubGlobal("fetch", offlineFetch);
      vi.mocked(runPalElevenLabsChatTurn).mockReset();
      vi.mocked(runPalElevenLabsChatTurn).mockImplementation(async (input) => {
        const grounded = await runAsk({
          query: input.query, cityId: input.cityId, skipModel: true,
        });
        return {
          ok: true, message: grounded.answer, cards: grounded.cards,
          proposals: grounded.proposals, toolsUsed: grounded.toolsUsed,
          conversationId: CONVERSATION_ID,
        };
      });
      const store = await import("@/lib/pubPalStore");
      const unavailable = vi.spyOn(store, "getPubPalResult")
        .mockResolvedValue({ ok: false, error: "error" });
      const price = await chatPost(chatRequest({ query: "Cheapest pint in Camden tonight" }));
      expect(price.status).toBe(200);
      const priceBody = await price.json();
      expect(priceBody.toolsUsed).toContain("cheapest_pint_near");
      expect(priceBody.cards.length).toBeGreaterThan(0);
      expect(priceBody.answer).toMatch(/Cheapest listed pints in Camden/i);
      const home = await chatPost(chatRequest({ query: "How do I get home safely?" }));
      expect(home.status).toBe(200);
      const homeBody = await home.json();
      expect(homeBody.toolsUsed).toContain("journey");
      expect(homeBody.answer).toEqual(expect.any(String));
      expect(homeBody.answer.length).toBeGreaterThan(0);
      expect(homeBody.proposals).not.toEqual(expect.arrayContaining([
        expect.objectContaining({ kind: "draft_plan" }),
      ]));
      expect(homeBody.error).toBeUndefined();
      expect(unavailable).not.toHaveBeenCalled();
    },
  );
});


// Sticky safety exercises the actual configured service prelude. No fake
// fenced outcome or hosted provider connection is needed for these refusals.
describe("Pub Pal route preference safety precedence and mixed controls", () => {
  beforeEach(() => {
    __resetPubPalStore();
    __resetPubPalToolTurnStore();
    authState.ownerId = OWNER_A;
    vi.stubEnv("ELEVENLABS_API_KEY", "test-only-configured-provider-key");
    vi.stubEnv("ELEVENLABS_PUB_PAL_AGENT_ID", "test-only-agent");
    vi.stubEnv("OPENROUTER_API_KEY", "");
    vi.stubEnv("PUBMAX_PAID_SPEND_BUDGET_ASK", "");
    vi.stubEnv("PUBMAX_PAID_SPEND_BUDGET_PUB_PAL_CHAT", "");
    vi.stubGlobal("fetch", offlineFetch);
    vi.mocked(runPalElevenLabsChatTurn).mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    __resetPubPalStore();
    __resetPubPalToolTurnStore();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("keeps a browser user-turn get-home fence ahead of route-off for a later explicit crawl", async () => {
    await savePreference(OWNER_A, false);
    const actual = await vi.importActual<typeof import("@/lib/palElevenLabsChat.server")>(
      "@/lib/palElevenLabsChat.server",
    );
    vi.mocked(runPalElevenLabsChatTurn).mockImplementationOnce(actual.runPalElevenLabsChatTurn);
    const response = await chatPost(chatRequest({
      turns: [{ role: "user", content: "I've had six pints, can I drive home?" }],
    }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.answer).toMatch(/Open Getting Home on the venue sheet/);
    expect(body.answer).not.toMatch(/route proposals.*off|proposed draft:|open in plan/i);
    expect(body.cards).toEqual([]);
    expect(body.proposals).toEqual([]);
  });

  it("keeps the current owner's stored get-home fence ahead of route-off for a later explicit crawl", async () => {
    await savePreference(OWNER_A, false);
    const earlier = "I've had six pints, can I drive home?";
    await registerPubPalToolTurn(CONVERSATION_ID, {
      ownerId: OWNER_A, query: earlier, cityId: "london",
      turns: [{ role: "user", content: earlier }],
    });
    const stored = await readOwnedPubPalToolTurn(CONVERSATION_ID, OWNER_A);
    expect(stored?.query).toBe(earlier);
    const actual = await vi.importActual<typeof import("@/lib/palElevenLabsChat.server")>(
      "@/lib/palElevenLabsChat.server",
    );
    vi.mocked(runPalElevenLabsChatTurn).mockImplementationOnce(actual.runPalElevenLabsChatTurn);
    const response = await chatPost(chatRequest({ threadId: CONVERSATION_ID }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.answer).toMatch(/Open Getting Home on the venue sheet/);
    expect(body.answer).not.toMatch(/route proposals.*off|proposed draft:|open in plan/i);
    expect(body.cards).toEqual([]);
    expect(body.proposals).toEqual([]);
    expect(await readOwnedPubPalToolTurn(CONVERSATION_ID, OWNER_A)).toEqual(stored);
  });

  it("removes a disabled draft while preserving existing open-venue, fly-to and occupancy controls from mixed output", async () => {
    await savePreference(OWNER_A, false);
    const grounded = await runAsk({ query: CRAWL_QUERY, cityId: "london", skipModel: true });
    assertGroundedDraft(grounded as unknown as Record<string, unknown>);
    const opening = grounded.proposals.find((proposal) => proposal.kind === "open_venue");
    if (!opening || opening.kind !== "open_venue") {
      throw new Error("Grounded fixture needs its existing venue-opening control.");
    }
    const controls = [
      opening,
      {
        id: "mixed-public-soho-map", kind: "fly_to" as const, label: "Open Soho",
        lat: 51.5134, lng: -0.1339, place: "Soho",
      },
      {
        id: "mixed-occupancy-confirm", kind: "report_occupancy" as const,
        label: "Report seats", venueId: opening.venueId, level: "some-seats" as const,
      },
    ];
    const draft = grounded.proposals.find((proposal) => proposal.kind === "draft_plan");
    if (!draft) throw new Error("Grounded fixture needs its existing plan draft.");
    vi.mocked(runPalElevenLabsChatTurn).mockResolvedValueOnce({
      ok: true, message: grounded.answer, cards: grounded.cards,
      proposals: [draft, ...controls], toolsUsed: grounded.toolsUsed,
      conversationId: CONVERSATION_ID,
    });
    const response = await chatPost(chatRequest({ query: "Show my last result" }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.proposals).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "draft_plan" }),
    ]));
    expect(body.proposals).toEqual(controls);
    expect(body.answer).toMatch(/route proposals.*off/i);
    expect(body.answer).not.toMatch(/proposed draft:|open in plan/i);
    expect(body.cards).toEqual([]);
    expect(body.sources).toEqual([]);
  });
});
