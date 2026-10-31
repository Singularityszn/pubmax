import { CHAINED_ALCOHOL_FITNESS_QUESTIONS, QUANTITY_FITNESS_CASES } from "./fixtures/pubPalTemporalSafety";
import { offlineFetch } from "@/evals/pal/offlineFetch";
import { NAMED_QUALIFIED_PRICE_REQUESTS, QUALIFIED_PRICE_REQUESTS } from "./fixtures/askPriceSubjects";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const PAL_GREETING = "Hello, I'm your Pub Pal. What kind of night are you planning?";
const SOURCED_ANSWER = "Two Soho picks with listed pints under five pounds.";
const CHECKING_LINE = "Let me check prices near Soho.";
// The provider's real shape: `signed_url` alone, the conversation id inside its query.
const SIGNED_URL =
  "wss://api.elevenlabs.io/v1/convai/conversation?agent_id=agent-id&conversation_signature=sig&conversation_id=conv_regression01";

type ScriptedEvent = { afterMs: number; event: Record<string, unknown> };

function agentResponse(text: string): Record<string, unknown> {
  return { type: "agent_response", agent_response_event: { agent_response: text } };
}

function toolRequest(id: string): Record<string, unknown> {
  return {
    type: "agent_tool_request",
    agent_tool_request: { tool_name: "search_venues", tool_call_id: id, tool_type: "webhook" },
  };
}

function toolResponse(id: string): Record<string, unknown> {
  return {
    type: "agent_tool_response",
    agent_tool_response: { tool_name: "search_venues", tool_call_id: id, is_error: false },
  };
}

function responsePart(
  type: "start" | "delta" | "stop",
  text = "",
  responseId = "resp_1",
): Record<string, unknown> {
  return {
    type: "agent_chat_response_part",
    text_response_part: { type, text, event_id: 1, response_id: responseId },
  };
}

function responseComplete(): Record<string, unknown> {
  return { type: "agent_response_complete", agent_response_complete_event: { event_id: 1 } };
}

const wsState = vi.hoisted(() => ({
  socketsOpened: 0,
  lastInitPayload: null as unknown,
  userMessageText: null as string | null,
  userMessageCount: 0,
  repeatMetadata: false,
  /** What the agent sends after the user message. Null sends the answer and the turn end. */
  replyScript: null as ScriptedEvent[] | null,
  /** False until the mock sends a tool response, as the webhook fills the store first. */
  storeFilled: true,
}));

class MockElevenLabsWebSocket {
  static OPEN = 1;
  private listeners: Record<string, Array<(event: unknown) => void>> = {};

  constructor(url: string) {
    void url;
    wsState.socketsOpened += 1;
    queueMicrotask(() => {
      this.emit("open", {});
      this.emit("message", {
        data: JSON.stringify({
          type: "agent_chat_response_part",
          text_response_part: { type: "delta", text: PAL_GREETING, event_id: 0, response_id: "greeting" },
        }),
      });
      this.emit("message", {
        data: JSON.stringify({
          type: "agent_response",
          agent_response_event: { agent_response: PAL_GREETING },
        }),
      });
      this.emit("message", {
        data: JSON.stringify({
          type: "conversation_initiation_metadata",
          conversation_initiation_metadata_event: { conversation_id: "conv_regression01" },
        }),
      });
      if (wsState.repeatMetadata) {
        this.emit("message", {
          data: JSON.stringify({
            type: "conversation_initiation_metadata",
            conversation_initiation_metadata_event: { conversation_id: "conv_regression01" },
          }),
        });
      }
    });
  }

  addEventListener(type: string, listener: (event: unknown) => void): void {
    (this.listeners[type] ??= []).push(listener);
  }

  send(raw: string): void {
    const payload = JSON.parse(raw) as { type?: string; text?: string };
    if (payload.type === "conversation_initiation_client_data") {
      wsState.lastInitPayload = payload;
      return;
    }
    if (payload.type === "user_message") {
      wsState.userMessageCount += 1;
      wsState.userMessageText = payload.text ?? null;
      if (wsState.replyScript) {
        let at = 0;
        for (const step of wsState.replyScript) {
          at += step.afterMs;
          setTimeout(() => this.emit("message", { data: JSON.stringify(step.event) }), at);
        }
        return;
      }
      queueMicrotask(() => {
        this.emit("message", { data: JSON.stringify(agentResponse(SOURCED_ANSWER)) });
        this.emit("message", { data: JSON.stringify(responseComplete()) });
      });
    }
  }

  close(): void {
    // noop
  }

  private emit(type: string, event: unknown): void {
    if (type === "message" && String((event as { data?: unknown }).data).includes('"agent_tool_response"')) {
      wsState.storeFilled = true;
    }
    for (const listener of this.listeners[type] ?? []) listener(event);
  }
}

const fenceMocks = vi.hoisted(() => ({
  resolvePubPalFenceIntent: vi.fn<
    (message: string, turns: Array<{ role: "user" | "assistant"; content: string }>) => Promise<{
      fenced: boolean;
      sobrietyOnly: boolean;
    }>
  >(async () => ({ fenced: false, sobrietyOnly: false })),
}));

vi.mock("@/lib/pubPalLlmFence", () => ({
  resolvePubPalFenceIntent: fenceMocks.resolvePubPalFenceIntent,
  pubPalGetHomeRegisterAnswer: vi.fn(() => "Getting Home has the trains."),
}));

const NOTHING_CONFIRMED = "I have not confirmed anything for you to remember about me.";

const toolTurnPayload = {
    query: "Which quiet pubs near Soho have a beer garden?",
    cityId: "london" as const,
    turns: [],
    summary: "",
    expiresAt: Date.now() + 60_000,
    cards: [
      {
        key: "v1",
        venueId: "london-a",
        title: "The Crown",
        place: "Soho",
        note: "Listed pint.",
        price: 4.8,
      },
    ],
    proposals: [],
    hints: [],
    toolsUsed: ["search_venues"],
  };

const storeMocks = vi.hoisted(() => ({
  registerPubPalToolTurn: vi.fn<(conversationId: string, input: unknown) => Promise<void>>(
    async () => {},
  ),
  readOwnedPubPalToolTurn: vi.fn<(conversationId: string, ownerId: string) => Promise<unknown>>(
    async () => null,
  ),
}));

vi.mock("@/lib/pubPalToolTurnStore", () => ({
  registerPubPalToolTurn: storeMocks.registerPubPalToolTurn,
  readPubPalToolTurn: vi.fn(async () =>
    wsState.storeFilled ? toolTurnPayload : { ...toolTurnPayload, cards: [], toolsUsed: [] },
  ),
  readOwnedPubPalToolTurn: storeMocks.readOwnedPubPalToolTurn,
}));

const tasteMocks = vi.hoisted(() => ({
  readPalTaste: vi.fn<(ownerId: string) => Promise<unknown>>(async () => null),
}));

vi.mock("@/lib/palTaste.server", () => ({ readPalTaste: tasteMocks.readPalTaste }));

import { VIBE_CHIPS } from "@/lib/vibeChips";
import { runPalElevenLabsChatTurn } from "@/lib/palElevenLabsChat.server";
import { pubPalGetHomeRegisterAnswer } from "@/lib/pubPalLlmFence";
import { readPubPalToolTurn } from "@/lib/pubPalToolTurnStore";
import { DEFAULT_PAL_DRAFT } from "@/lib/pubPal";
import { __resetPubPalStore, confirmPalMemoryResult, createPubPalResult } from "@/lib/pubPalStore";

describe("runPalElevenLabsChatTurn", () => {
  beforeEach(() => {
    vi.mocked(pubPalGetHomeRegisterAnswer).mockReset().mockReturnValue("Getting Home has the trains.");
    wsState.socketsOpened = 0;
    wsState.lastInitPayload = null;
    wsState.userMessageText = null;
    wsState.userMessageCount = 0;
    wsState.repeatMetadata = false;
    wsState.replyScript = null;
    wsState.storeFilled = true;
    vi.stubEnv("ELEVENLABS_API_KEY", "test-key");
    vi.stubEnv("ELEVENLABS_PUB_PAL_AGENT_ID", "agent-id");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ signed_url: SIGNED_URL }),
      ),
    );
    vi.stubGlobal("WebSocket", MockElevenLabsWebSocket);
    storeMocks.registerPubPalToolTurn.mockClear();
    storeMocks.readOwnedPubPalToolTurn.mockReset();
    storeMocks.readOwnedPubPalToolTurn.mockResolvedValue(null);
    fenceMocks.resolvePubPalFenceIntent.mockReset();
    fenceMocks.resolvePubPalFenceIntent.mockResolvedValue({ fenced: false, sobrietyOnly: false });
    tasteMocks.readPalTaste.mockReset();
    tasteMocks.readPalTaste.mockResolvedValue(null);
  });

  afterEach(() => {
    __resetPubPalStore();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("sends the current ask once when provider metadata repeats during registration", async () => {
    wsState.repeatMetadata = true;
    const outcome = await runPalElevenLabsChatTurn({
      query: "Which quiet pubs near Soho have a beer garden?",
      ownerId: "11111111-1111-4111-8111-111111111111",
    });
    expect(outcome).toMatchObject({ ok: true });
    expect(wsState.userMessageCount).toBe(1);
  });

  it("ends a hung owned-history read within the chat deadline and ignores its late result", async () => {
    vi.useFakeTimers();
    let finishHistory!: (value: unknown) => void;
    storeMocks.readOwnedPubPalToolTurn.mockImplementationOnce(() => new Promise((resolve) => {
      finishHistory = resolve;
    }));
    let outcome: Awaited<ReturnType<typeof runPalElevenLabsChatTurn>> | undefined;
    void runPalElevenLabsChatTurn({
      query: "Which quiet pubs near Soho have a beer garden?",
      ownerId: "11111111-1111-4111-8111-111111111111",
      threadId: "conv_previous01",
    }).then((result) => { outcome = result; });
    await vi.advanceTimersByTimeAsync(21_999);
    expect(outcome).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(outcome).toEqual({ ok: false, code: "TIMEOUT" });
    finishHistory(null);
    await vi.advanceTimersByTimeAsync(0);
    expect(wsState.socketsOpened).toBe(0);
    expect(wsState.userMessageCount).toBe(0);
  });

  it("counts owned-history latency inside the provider request deadline", async () => {
    vi.useFakeTimers();
    storeMocks.readOwnedPubPalToolTurn.mockImplementationOnce(() => new Promise((resolve) => {
      setTimeout(() => resolve(null), 21_000);
    }));
    vi.stubGlobal("fetch", vi.fn((_url, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    })));
    let outcome: Awaited<ReturnType<typeof runPalElevenLabsChatTurn>> | undefined;
    void runPalElevenLabsChatTurn({
      query: "Which quiet pubs near Soho have a beer garden?",
      ownerId: "11111111-1111-4111-8111-111111111111",
      threadId: "conv_previous01",
    }).then((result) => { outcome = result; });
    await vi.advanceTimersByTimeAsync(21_999);
    expect(outcome).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(outcome).toEqual({ ok: false, code: "TIMEOUT" });
    expect(wsState.socketsOpened).toBe(0);
  });

  it.each([
    "Cheap pints near Soho",
    "Cheapest decent pint for a quick one after work",
    "Find me three pubs near Soho with listed pint prices. Show the source dates and the map.",
  ])("answers local pint discovery when the provider is unavailable: %s", async (query) => {
    vi.stubEnv("TYPESAFE_API_KEY", "unused-test-key");
    const deniedFetch = vi.fn(offlineFetch);
    vi.stubGlobal("fetch", deniedFetch);
    const outcome = await runPalElevenLabsChatTurn({ query, ownerId: "11111111-1111-4111-8111-111111111111" });
    expect(outcome).toMatchObject({ ok: true, toolsUsed: ["search_venues"] });
    if (!outcome.ok) return;
    expect(outcome.cards.length).toBe(query.startsWith("Find") ? 3 : 4);
    expect(outcome.cards.every((card) => typeof card.price === "number" && card.price > 0)).toBe(true);
    expect(outcome.cards.every((card) => /Recorded|Source|Publisher/i.test(card.provenance?.label ?? ""))).toBe(true);
    expect(outcome.proposals.length).toBeGreaterThan(0);
    expect(wsState.socketsOpened).toBe(0);
    expect(deniedFetch).not.toHaveBeenCalled();
    expect(tasteMocks.readPalTaste).not.toHaveBeenCalled();
    expect(storeMocks.registerPubPalToolTurn).toHaveBeenCalledWith(outcome.conversationId, expect.objectContaining({ query, ownerId: "11111111-1111-4111-8111-111111111111", cards: outcome.cards }));
  });

  it.each(["failed", "stalled"] as const)("keeps local cards when conversation registration is %s", async (failure) => {
    storeMocks.registerPubPalToolTurn.mockImplementationOnce(() => failure === "failed"
      ? Promise.reject(new Error("Store unavailable")) : new Promise(() => {}));
    const outcome = await runPalElevenLabsChatTurn({ query: "Cheap pints near Soho", ownerId: "11111111-1111-4111-8111-111111111111" });
    expect(outcome).toMatchObject({ ok: true, conversationId: "", toolsUsed: ["search_venues"] });
    if (outcome.ok) {
      expect(outcome.cards).toHaveLength(4);
      expect(outcome.message).toContain("Conversation history could not be kept");
    }
    expect(wsState.socketsOpened).toBe(0);
  }, 3_000);

  it("keeps the owned area and budget for a local follow-up", async () => {
    storeMocks.readOwnedPubPalToolTurn.mockResolvedValue({ ...toolTurnPayload, query: "Find me four pubs in Soho and show them on the map.", turns: [], summary: "" });
    const query = "Same area, but under £6.50 a pint.";
    const outcome = await runPalElevenLabsChatTurn({ query, ownerId: "11111111-1111-4111-8111-111111111111", threadId: "conv_ownedfollow1",
      fenceTurns: [{ role: "user", content: "Find pubs in Camden" }],
    });
    expect(outcome.ok).toBe(true);
    expect(storeMocks.registerPubPalToolTurn).toHaveBeenCalledWith("conv_ownedfollow1", expect.objectContaining({ query, turns: [{ role: "user", content: "Find me four pubs in Soho and show them on the map." }] }));
    if (outcome.ok) {
      expect(outcome.cards.length).toBeGreaterThan(0);
      expect(outcome.cards.every((card) => typeof card.price === "number" && card.price <= 6.5)).toBe(true);
      expect(outcome.cards.some((card) => card.venueId === "venue-e1srzr")).toBe(true);
    }
    expect(wsState.socketsOpened).toBe(0);
    expect(wsState.userMessageText).toBeNull();
  });

  it("review regression: returns independent transit with the unsupported price answer", async () => {
    vi.stubGlobal("fetch", offlineFetch);
    const outcome = await runPalElevenLabsChatTurn({ query: "Any tube delays and how much is a burger in Camden?", ownerId: "11111111-1111-4111-8111-111111111111" });
    expect(outcome).toMatchObject({ ok: true, toolsUsed: ["city_status"], cards: [], proposals: [] });
    if (outcome.ok) {
      expect(outcome.message).toMatch(/meal prices/i);
      expect(outcome.message).toMatch(/transit|city status|tube|weather/i);
    }
    expect(wsState.socketsOpened).toBe(0);
  });

  it.each(NAMED_QUALIFIED_PRICE_REQUESTS.filter(({ query }) => /this evening|now|later/.test(query)))("accepts named time-qualified prices in configured chat: $query", async ({ query, tool }) => {
    const outcome = await runPalElevenLabsChatTurn({ query, ownerId: "11111111-1111-4111-8111-111111111111" });
    if (tool === "venue_drinks") {
      // A first answer from the records still opens a local thread the follow-up reads.
      expect(outcome).toMatchObject({ ok: true, conversationId: expect.stringMatching(/^conv_pal[A-Za-z0-9]{32}$/), toolsUsed: ["venue_drinks"] });
      expect(storeMocks.registerPubPalToolTurn).toHaveBeenCalledWith(
        outcome.ok ? outcome.conversationId : "",
        expect.objectContaining({ query }),
      );
      expect(wsState.socketsOpened).toBe(0);
      expect(fetch).not.toHaveBeenCalled();
    } else {
      expect(outcome).toMatchObject({ ok: true, conversationId: "conv_regression01" });
      expect(wsState.socketsOpened).toBe(1);
      expect(wsState.userMessageText).toContain(`Current user message: ${query}`);
      expect(storeMocks.registerPubPalToolTurn).toHaveBeenCalledWith("conv_regression01", expect.objectContaining({ query }));
    }
  });

  it("keeps quiet-pub constraints in a local cheap-pint answer", async () => {
    const query = "Find cheap quiet pubs in Soho";
    const outcome = await runPalElevenLabsChatTurn({ query, ownerId: "11111111-1111-4111-8111-111111111111" });
    expect(outcome).toMatchObject({ ok: true, toolsUsed: ["search_venues"] });
    if (outcome.ok) {
      expect(outcome.cards.length).toBeGreaterThan(0);
      expect(outcome.cards.every((card) => typeof card.price === "number" && card.price <= 6)).toBe(true);
    }
    expect(wsState.socketsOpened).toBe(0);
  });

  it.each(QUALIFIED_PRICE_REQUESTS)("fences the full qualified subject before configured startup: $query", async ({ query, wording }) => {
    const outcome = await runPalElevenLabsChatTurn({ query, ownerId: "11111111-1111-4111-8111-111111111111" });
    expect(outcome).toMatchObject({ ok: true, message: expect.stringMatching(wording), cards: [], proposals: [], toolsUsed: [] });
    expect(wsState.socketsOpened).toBe(0);
    expect(fetch).not.toHaveBeenCalled();
    expect(storeMocks.registerPubPalToolTurn).not.toHaveBeenCalled();
  });

  it.each([
    "Plan a big night for four of us, with cheap pints and a lively route",
  ])("preserves supported constraints when starting configured chat: %s", async (query) => {
    const outcome = await runPalElevenLabsChatTurn({
      query, ownerId: "11111111-1111-4111-8111-111111111111",
    });
    expect(outcome).toMatchObject({ ok: true, conversationId: "conv_regression01" });
    expect(wsState.socketsOpened).toBe(1);
    expect(wsState.userMessageText).toContain(`Current user message: ${query}`);
    expect(storeMocks.registerPubPalToolTurn).toHaveBeenCalledWith("conv_regression01", expect.objectContaining({ query }));
  });

  it.each([
    ["Cheapest vegan food in Camden", "I can't compare meal prices or check dietary options yet. I can help you find pubs with food."],
    ["Cheapest wine in Soho", "I can compare listed pint prices, but not other drinks across pubs yet. Name a pub and I'll check its recorded drinks."],
    ["Cheapest vegan curry in Camden", "I can compare listed pint prices, but not prices for that item yet. Ask about pints or name a pub to check its recorded drinks."],
    ["Cheapest Coke in Camden", "I can compare listed pint prices, but not prices for that item yet. Ask about pints or name a pub to check its recorded drinks."],
    ["Cheapest sparkling water in Camden", "I can compare listed pint prices, but not prices for that item yet. Ask about pints or name a pub to check its recorded drinks."],
    ["Cheapest pub lunch in Camden", "I can't compare meal prices or check dietary options yet. I can help you find pubs with food."],
    ["How much is a pint and food at The Lamb?", "I can't compare meal prices or check dietary options yet. I can help you find pubs with food."],
    ["Costs for burgers in Camden", "I can't compare meal prices or check dietary options yet. I can help you find pubs with food."],
  ])("refuses configured %s before starting a provider session", async (query, message) => {
    wsState.storeFilled = false;
    wsState.replyScript = [
      { afterMs: 0, event: agentResponse("The cheapest option in Camden costs £3.40.") },
      { afterMs: 0, event: responseComplete() },
    ];

    const outcome = await runPalElevenLabsChatTurn({
      query,
      ownerId: "11111111-1111-4111-8111-111111111111",
    });

    expect(outcome).toEqual({
      ok: true,
      message,
      cards: [],
      proposals: [],
      conversationId: "",
      toolsUsed: [],
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(wsState.socketsOpened).toBe(0);
    expect(storeMocks.registerPubPalToolTurn).not.toHaveBeenCalled();
    expect(wsState.userMessageText).toBeNull();
  });

  it.each([
    ...VIBE_CHIPS.filter((chip) => chip.ask !== "Cheapest decent pint for a quick one after work").map((chip) => chip.ask),
    "somewhere cheap and quiet", "Somewhere cheap in Soho",
  ])("accepts the original supported question at configured startup: %s", async (query) => {
    wsState.storeFilled = false;
    wsState.replyScript = [
      { afterMs: 0, event: agentResponse(SOURCED_ANSWER) },
      { afterMs: 0, event: responseComplete() },
    ];
    const outcome = await runPalElevenLabsChatTurn({
      query, ownerId: "11111111-1111-4111-8111-111111111111",
    });
    expect(outcome.ok).toBe(true);
    expect(wsState.socketsOpened).toBe(1);
    expect(wsState.userMessageText).toContain(query);
    expect(storeMocks.registerPubPalToolTurn).toHaveBeenCalledWith(
      "conv_regression01", expect.objectContaining({ query }),
    );
  });

  it.each(QUANTITY_FITNESS_CASES.flatMap((entry) => (["current", "user", "assistant"] as const).map((role) => ({ ...entry, role }))))(
    "classifies numeric quantities in provider $role turns: $query", async ({ query, fenced, role }) => {
      vi.stubEnv("TYPESAFE_API_KEY", "");
      const actual = await vi.importActual<typeof import("@/lib/pubPalLlmFence")>("@/lib/pubPalLlmFence");
      fenceMocks.resolvePubPalFenceIntent.mockImplementation(actual.resolvePubPalFenceIntent);
      vi.mocked(pubPalGetHomeRegisterAnswer).mockImplementationOnce(actual.pubPalGetHomeRegisterAnswer);
      if (role !== "current") storeMocks.readOwnedPubPalToolTurn.mockResolvedValue({
        ...toolTurnPayload, query: "Find four quiet pubs in Soho", turns: [{ role, content: query }],
      });
      const outcome = await runPalElevenLabsChatTurn({
        query: role === "current" ? query : "Find four quiet pubs in Soho",
        threadId: role === "current" ? undefined : "conv_quantityprevious01",
        ownerId: "11111111-1111-4111-8111-111111111111",
      });
      expect(outcome.ok).toBe(true);
      if (fenced && role !== "assistant") {
        expect(outcome).toMatchObject({
          message: "I can't tell you whether to have another drink. Open Getting Home on the venue sheet for last-train times, ride links, and the TfL planner.",
          conversationId: "", cards: [], proposals: [], toolsUsed: [],
        });
        expect(fetch).not.toHaveBeenCalled();
        expect(wsState.socketsOpened).toBe(0);
      } else {
        expect(outcome).toMatchObject({ message: SOURCED_ANSWER });
        expect(wsState.socketsOpened).toBe(1);
      }
    },
  );

  it.each([
    ...CHAINED_ALCOHOL_FITNESS_QUESTIONS,
    "Where can I buy beer in Soho? How many pints can I have before driving?",
    "How many pints can I have before driving? Where should we have beer in Soho?",
    "Where can I drink beer in Soho? Would it be safe to drive after two beers?",
    "Where can I buy beer after cycling through Soho? Would it be safe to drive after two beers?",
    "Can I drink 1.5 pints in Soho before driving?",
    "Would it be safe to drive after 1.5 pints?",
  ].flatMap((query) => [
    { query, history: false },
    { query, history: true },
  ]))("fences mixed discovery and alcohol allowance before provider startup: $query $history", async ({ query, history }) => {
    vi.stubEnv("TYPESAFE_API_KEY", "");
    const actual = await vi.importActual<typeof import("@/lib/pubPalLlmFence")>("@/lib/pubPalLlmFence");
    fenceMocks.resolvePubPalFenceIntent.mockImplementation((message, turns) => actual.resolvePubPalFenceIntent(message, turns));
    vi.mocked(pubPalGetHomeRegisterAnswer).mockImplementationOnce(actual.pubPalGetHomeRegisterAnswer);

    const outcome = await runPalElevenLabsChatTurn({
      query: history ? "What about Soho?" : query,
      fenceTurns: history ? [{ role: "user", content: query }] : [],
      ownerId: "11111111-1111-4111-8111-111111111111",
    });

    expect(outcome).toEqual({
      ok: true,
      message: "I can't tell you whether to have another drink. Open Getting Home on the venue sheet for last-train times, ride links, and the TfL planner.",
      cards: [],
      proposals: [],
      conversationId: "",
      toolsUsed: [],
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(wsState.socketsOpened).toBe(0);
    expect(tasteMocks.readPalTaste).not.toHaveBeenCalled();
    expect(storeMocks.registerPubPalToolTurn).not.toHaveBeenCalled();
  });

  it.each(["user", "assistant"] as const)("classifies chained alcohol questions in owned %s history", async (role) => {
    vi.stubEnv("TYPESAFE_API_KEY", "");
    const actual = await vi.importActual<typeof import("@/lib/pubPalLlmFence")>("@/lib/pubPalLlmFence");
    fenceMocks.resolvePubPalFenceIntent.mockImplementation((message, turns) => actual.resolvePubPalFenceIntent(message, turns));
    if (role === "user") vi.mocked(pubPalGetHomeRegisterAnswer).mockImplementationOnce(actual.pubPalGetHomeRegisterAnswer);
    storeMocks.readOwnedPubPalToolTurn.mockResolvedValue({
      ...toolTurnPayload, query: "Quiet pubs in Soho",
      turns: [{ role, content: CHAINED_ALCOHOL_FITNESS_QUESTIONS[0] }],
    });
    const outcome = await runPalElevenLabsChatTurn({
      query: "What about Soho?", threadId: "conv_previous01",
      ownerId: "11111111-1111-4111-8111-111111111111",
    });
    expect(outcome.ok).toBe(true);
    if (role === "user") {
      expect(outcome).toMatchObject({
        message: "I can't tell you whether to have another drink. Open Getting Home on the venue sheet for last-train times, ride links, and the TfL planner.",
        conversationId: "", cards: [], proposals: [], toolsUsed: [],
      });
      expect(fetch).not.toHaveBeenCalled();
      expect(wsState.socketsOpened).toBe(0);
    } else {
      expect(outcome).toMatchObject({ message: SOURCED_ANSWER });
      expect(wsState.socketsOpened).toBe(1);
    }
  });

  it("keeps the sobriety fence before configured price coverage", async () => {
    fenceMocks.resolvePubPalFenceIntent.mockResolvedValue({ fenced: true, sobrietyOnly: false });

    const outcome = await runPalElevenLabsChatTurn({
      query: "Cheapest vegan food in Camden before I drive home",
      ownerId: "11111111-1111-4111-8111-111111111111",
    });

    expect(outcome).toMatchObject({
      ok: true,
      message: "Getting Home has the trains.",
      cards: [],
      toolsUsed: [],
      conversationId: "",
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(wsState.socketsOpened).toBe(0);
  });

  it("refuses a configured area burger-price ask before the provider can substitute a pint", async () => {
    wsState.storeFilled = false;
    wsState.replyScript = [
      { afterMs: 0, event: agentResponse("The burger in Camden costs £3.40.") },
      { afterMs: 0, event: responseComplete() },
    ];

    const outcome = await runPalElevenLabsChatTurn({
      query: "How much is a burger in Camden?",
      ownerId: "11111111-1111-4111-8111-111111111111",
    });

    expect(outcome).toMatchObject({
      ok: true,
      cards: [],
      proposals: [],
      conversationId: "",
      toolsUsed: [],
    });
    expect(outcome.ok && outcome.message).toMatch(/meal prices|food prices|menu prices/i);
    expect(fetch).not.toHaveBeenCalled();
    expect(wsState.socketsOpened).toBe(0);
    expect(storeMocks.registerPubPalToolTurn).not.toHaveBeenCalled();
  });

  it("asks for the ambiguous Coke pub identity before provider startup", async () => {
    wsState.storeFilled = false;
    wsState.replyScript = [
      { afterMs: 0, event: agentResponse("Coke at The Eagle costs £6.25.") },
      { afterMs: 0, event: responseComplete() },
    ];

    const outcome = await runPalElevenLabsChatTurn({
      query: "Price of Coke at The Eagle",
      ownerId: "11111111-1111-4111-8111-111111111111",
    });

    expect(outcome).toMatchObject({
      ok: true,
      cards: [],
      proposals: [],
      conversationId: expect.stringMatching(/^conv_pal[A-Za-z0-9]{32}$/),
      toolsUsed: ["venue_drinks"],
    });
    expect(outcome.ok && outcome.message).toMatch(/listed pub/i);
    expect(fetch).not.toHaveBeenCalled();
    expect(wsState.socketsOpened).toBe(0);
    // The clarifying answer keeps its thread, so naming the pub next continues it.
    expect(storeMocks.registerPubPalToolTurn).toHaveBeenCalledWith(
      outcome.ok ? outcome.conversationId : "",
      expect.objectContaining({ query: "Price of Coke at The Eagle" }),
    );
  });

  it.each([
    ["hi", "Hey. Where are you heading tonight?"],
    ["hello", "Hey. Where are you heading tonight?"],
    ["thanks", "You're welcome."],
  ])("returns a short provider reply for %s without factual cards or tools", async (query, reply) => {
    wsState.storeFilled = false;
    wsState.replyScript = [
      { afterMs: 0, event: agentResponse(reply) },
      { afterMs: 0, event: responseComplete() },
    ];

    const outcome = await runPalElevenLabsChatTurn({
      query,
      ownerId: "11111111-1111-4111-8111-111111111111",
    });

    expect(outcome).toMatchObject({ ok: true, message: reply, cards: [], toolsUsed: [] });
    expect(wsState.userMessageText).toBe([NOTHING_CONFIRMED, `Current user message: ${query}`].join("\n"));
  });

  it("returns the post-query agent reply, not the configured first_message greeting", async () => {
    const query = "Which quiet pubs near Soho have a beer garden?";
    const outcome = await runPalElevenLabsChatTurn({
      query,
      ownerId: "11111111-1111-4111-8111-111111111111",
    });

    expect(outcome).toMatchObject({
      ok: true,
      message: SOURCED_ANSWER,
      conversationId: "conv_regression01",
    });
    expect(outcome.ok === true && outcome.message).not.toBe(PAL_GREETING);
    expect(wsState.userMessageText).toBe([NOTHING_CONFIRMED, `Current user message: ${query}`].join("\n"));
    expect(outcome.ok === true && outcome.cards.length).toBeGreaterThan(0);

    const init = wsState.lastInitPayload as {
      conversation_config_override?: { agent?: { first_message?: string; prompt?: unknown } };
    };
    expect(init?.conversation_config_override?.agent?.first_message).toBe("");
    expect(init?.conversation_config_override?.agent).not.toHaveProperty("prompt");
    expect(init).not.toHaveProperty("dynamic_variables");
    expect(JSON.stringify(init)).not.toContain(query);
  });

  it("carries the owner's own earlier asks from the stored thread into the user message", async () => {
    const ownerId = "11111111-1111-4111-8111-111111111111";
    storeMocks.readOwnedPubPalToolTurn.mockResolvedValue({
      ...toolTurnPayload,
      query: "quiet pubs in Soho",
      turns: [{ role: "user", content: "a pub for six" }],
    });

    const outcome = await runPalElevenLabsChatTurn({
      query: "what about somewhere cheaper there?",
      ownerId,
      threadId: "conv_previous01",
    });

    expect(outcome.ok).toBe(true);
    expect(storeMocks.readOwnedPubPalToolTurn).toHaveBeenCalledWith("conv_previous01", ownerId);
    expect(wsState.userMessageText).toBe(
      [
        NOTHING_CONFIRMED,
        "My earlier asks in this chat, oldest first:",
        "- a pub for six",
        "- quiet pubs in Soho",
        "Current user message: what about somewhere cheaper there?",
      ].join("\n"),
    );
    expect(storeMocks.registerPubPalToolTurn).toHaveBeenCalledWith(
      "conv_regression01",
      expect.objectContaining({
        query: "what about somewhere cheaper there?",
        ownerId,
        turns: [
          { role: "user", content: "a pub for six" },
          { role: "user", content: "quiet pubs in Soho" },
        ],
      }),
    );
    expect(JSON.stringify(wsState.lastInitPayload)).not.toContain("quiet pubs in Soho");
  });

  it("waits for the owned context safety check before requesting a signed URL", async () => {
    let releasePrior: (value: null) => void = () => {};
    storeMocks.readOwnedPubPalToolTurn.mockImplementation(
      () => new Promise((resolve) => { releasePrior = resolve; }),
    );

    const pending = runPalElevenLabsChatTurn({
      query: "quiet pubs",
      ownerId: "11111111-1111-4111-8111-111111111111",
      threadId: "conv_previous01",
    });
    await Promise.resolve();

    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    releasePrior(null);
    expect((await pending).ok).toBe(true);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  it("registers the turn under the signed URL's conversation before the socket names it", async () => {
    const order: string[] = [];
    storeMocks.registerPubPalToolTurn.mockImplementationOnce(async (conversationId) => {
      order.push(`register:${conversationId}`);
    });
    const RealSocket = MockElevenLabsWebSocket;
    vi.stubGlobal(
      "WebSocket",
      class extends RealSocket {
        constructor(url: string) {
          order.push("socket");
          super(url);
        }
      },
    );

    const outcome = await runPalElevenLabsChatTurn({
      query: "quiet pubs",
      ownerId: "11111111-1111-4111-8111-111111111111",
    });

    expect(outcome.ok).toBe(true);
    expect(order).toEqual(["register:conv_regression01", "socket"]);
    expect(storeMocks.registerPubPalToolTurn).toHaveBeenCalledTimes(1);
  });

  it("rolls asks older than the recent window into one summary turn and stores it with the new turn", async () => {
    const ownerId = "11111111-1111-4111-8111-111111111111";
    storeMocks.readOwnedPubPalToolTurn.mockResolvedValue({
      ...toolTurnPayload,
      summary: "a pub for six",
      turns: Array.from({ length: 6 }, (_, index) => ({ role: "user", content: `ask ${index + 1}` })),
      query: "ask 7",
    });

    const outcome = await runPalElevenLabsChatTurn({
      query: "and somewhere cheaper?",
      ownerId,
      threadId: "conv_previous01",
    });

    expect(outcome.ok).toBe(true);
    expect(wsState.userMessageText).toBe(
      [
        NOTHING_CONFIRMED,
        "My earlier asks, not facts about any pub: a pub for six; ask 1",
        "My earlier asks in this chat, oldest first:",
        "- ask 2",
        "- ask 3",
        "- ask 4",
        "- ask 5",
        "- ask 6",
        "- ask 7",
        "Current user message: and somewhere cheaper?",
      ].join("\n"),
    );
    expect(storeMocks.registerPubPalToolTurn).toHaveBeenCalledWith(
      "conv_regression01",
      expect.objectContaining({
        summary: "a pub for six\nask 1",
        turns: ["ask 2", "ask 3", "ask 4", "ask 5", "ask 6", "ask 7"].map((content) => ({ role: "user", content })),
      }),
    );
  });

  it("puts the owner's own confirmed memories ahead of the ask, and no one else's", async () => {
    __resetPubPalStore();
    const ownerId = "11111111-1111-4111-8111-111111111111";
    const strangerId = "22222222-2222-4222-8222-222222222222";
    for (const [id, value] of [[ownerId, "Cask ale, no lager"], [strangerId, "Stranger's rooftop bars"]] as const) {
      expect((await createPubPalResult(id, { ...DEFAULT_PAL_DRAFT, adultConfirmed: true, name: "Morrow" })).ok).toBe(true);
      expect((await confirmPalMemoryResult(id, { kind: "drink_preference", value })).ok).toBe(true);
    }

    const outcome = await runPalElevenLabsChatTurn({ query: "a pub in Soho tonight", ownerId });

    expect(outcome.ok).toBe(true);
    expect(wsState.userMessageText?.split("\n").slice(-2)).toEqual([
      "- Drinks: Cask ale, no lager",
      "Current user message: a pub in Soho tonight",
    ]);
    expect(wsState.userMessageText).not.toContain("Stranger's rooftop bars");
    expect(JSON.stringify(wsState.lastInitPayload)).not.toContain("Cask ale");
    __resetPubPalStore();
  });

  it("carries the owner's own taste read after the memories, never in the system prompt", async () => {
    const ownerId = "11111111-1111-4111-8111-111111111111";
    tasteMocks.readPalTaste.mockResolvedValue({
      visits: 5,
      distinctPubs: 2,
      lastVisit: { name: "The Crown", on: "2026-10-09" },
      patches: ["Soho"],
      regulars: ["The Crown"],
      loved: [],
      notKeen: [],
      drinks: ["Guinness"],
      usualPintGbp: 5.8,
      vibes: [],
      style: "regular",
      favouriteNight: null,
      wishlist: [],
    });

    const outcome = await runPalElevenLabsChatTurn({ query: "somewhere for a pint", ownerId });

    expect(outcome.ok).toBe(true);
    expect(tasteMocks.readPalTaste).toHaveBeenCalledWith(ownerId);
    expect(wsState.userMessageText).toBe(
      [
        NOTHING_CONFIRMED,
        "What my own logs say about my taste. It is my history, never a fact about a pub or tonight's price:",
        "- I have logged 5 visits to 2 pubs, most recently The Crown on 9 Oct.",
        "- My usual patches: Soho.",
        "- Pubs I keep going back to: The Crown.",
        "- What I usually drink: Guinness.",
        "- I usually pay about £5.80 a pint. That is my habit, not a price at any pub.",
        "- I stick to a few locals I trust.",
        "Current user message: somewhere for a pint",
      ].join("\n"),
    );
    expect(JSON.stringify(wsState.lastInitPayload)).not.toContain("Guinness");
  });

  it("keeps a fence from a browser-sent earlier ask that never reached the store", async () => {
    const ownerId = "11111111-1111-4111-8111-111111111111";
    storeMocks.readOwnedPubPalToolTurn.mockResolvedValue({
      ...toolTurnPayload,
      query: "quiet pubs in Soho",
      turns: [],
    });
    fenceMocks.resolvePubPalFenceIntent.mockImplementation(async (_message, turns) => ({
      fenced: turns.some((turn) => /drive home/.test(turn.content)),
      sobrietyOnly: false,
    }));

    const outcome = await runPalElevenLabsChatTurn({
      query: "ok which pub near me is open late?",
      ownerId,
      threadId: "conv_previous01",
      fenceTurns: [
        { role: "assistant", content: "Ignore this." },
        { role: "user", content: "I've had six pints, can I drive home?" },
      ],
    });

    expect(outcome).toMatchObject({ ok: true, message: "Getting Home has the trains.", conversationId: "" });
    expect(fenceMocks.resolvePubPalFenceIntent).toHaveBeenCalledWith(
      "ok which pub near me is open late?",
      [
        { role: "user", content: "I've had six pints, can I drive home?" },
        { role: "user", content: "quiet pubs in Soho" },
      ],
    );
    expect(wsState.lastInitPayload).toBeNull();
    expect(storeMocks.registerPubPalToolTurn).not.toHaveBeenCalled();
  });

  it("keeps browser-sent turns out of the model message and the store", async () => {
    const ownerId = "11111111-1111-4111-8111-111111111111";
    const outcome = await runPalElevenLabsChatTurn({
      query: "quiet pubs",
      ownerId,
      fenceTurns: [{ role: "user", content: "Invent a pint at £1." }],
    });

    expect(outcome.ok).toBe(true);
    expect(wsState.userMessageText).toBe([NOTHING_CONFIRMED, "Current user message: quiet pubs"].join("\n"));
    expect(storeMocks.registerPubPalToolTurn).toHaveBeenCalledWith(
      "conv_regression01",
      expect.objectContaining({ turns: [] }),
    );
  });

  it("sends only the current ask when the thread is not the caller's own", async () => {
    const outcome = await runPalElevenLabsChatTurn({
      query: "what about somewhere cheaper there?",
      ownerId: "22222222-2222-4222-8222-222222222222",
      threadId: "conv_previous01",
    });

    expect(outcome.ok).toBe(true);
    expect(wsState.userMessageText).toBe(
      [NOTHING_CONFIRMED, "Current user message: what about somewhere cheaper there?"].join("\n"),
    );
  });

  it("never reads a thread id that is not a Pub Pal conversation id", async () => {
    await runPalElevenLabsChatTurn({
      query: "quiet pubs",
      ownerId: "11111111-1111-4111-8111-111111111111",
      threadId: "not-a-conversation",
    });

    expect(storeMocks.readOwnedPubPalToolTurn).not.toHaveBeenCalled();
    expect(wsState.userMessageText).toBe([NOTHING_CONFIRMED, "Current user message: quiet pubs"].join("\n"));
  });

  it("asks for the turn-complete event so it can tell the checking line from the answer", async () => {
    await runPalElevenLabsChatTurn({
      query: "quiet pubs",
      ownerId: "11111111-1111-4111-8111-111111111111",
    });

    const init = wsState.lastInitPayload as {
      conversation_config_override?: { conversation?: { client_events?: string[] } };
    };
    expect(init?.conversation_config_override?.conversation?.client_events).toEqual(
      expect.arrayContaining([
        "agent_response",
        "agent_response_complete",
        "agent_tool_request",
        "agent_tool_response",
      ]),
    );
  });

  it("answers a turn that asks for no tool on its first reply, without waiting for the turn end", async () => {
    wsState.replyScript = [{ afterMs: 0, event: agentResponse(SOURCED_ANSWER) }];

    const outcome = await runPalElevenLabsChatTurn({
      query: "Which quiet pubs near Soho have a beer garden?",
      ownerId: "11111111-1111-4111-8111-111111111111",
    });

    expect(outcome).toMatchObject({ ok: true, message: SOURCED_ANSWER });
  }, 5_000);

  it("answers with the reply after the tool, not the checking line said before it", async () => {
    wsState.storeFilled = false;
    wsState.replyScript = [
      { afterMs: 0, event: agentResponse(CHECKING_LINE) },
      { afterMs: 50, event: toolRequest("call_1") },
      { afterMs: 900, event: toolResponse("call_1") },
      { afterMs: 50, event: agentResponse(SOURCED_ANSWER) },
      { afterMs: 10, event: responseComplete() },
    ];

    const outcome = await runPalElevenLabsChatTurn({
      query: "Which quiet pubs near Soho have a beer garden?",
      ownerId: "11111111-1111-4111-8111-111111111111",
    });

    expect(outcome).toMatchObject({ ok: true, message: SOURCED_ANSWER });
  });

  it("waits through a chained second tool asked for more than 600 ms after its checking line", async () => {
    wsState.storeFilled = false;
    wsState.replyScript = [
      { afterMs: 0, event: agentResponse(CHECKING_LINE) },
      { afterMs: 20, event: toolRequest("call_1") },
      { afterMs: 300, event: toolResponse("call_1") },
      { afterMs: 20, event: agentResponse("Now the trains.") },
      { afterMs: 800, event: toolRequest("call_2") },
      { afterMs: 300, event: toolResponse("call_2") },
      { afterMs: 20, event: agentResponse(SOURCED_ANSWER) },
      { afterMs: 10, event: responseComplete() },
    ];

    const outcome = await runPalElevenLabsChatTurn({
      query: "Which quiet pubs near Soho have a beer garden?",
      ownerId: "11111111-1111-4111-8111-111111111111",
    });

    expect(outcome).toMatchObject({ ok: true, message: SOURCED_ANSWER });
  });

  it("ignores a turn end that arrives while a tool is still running", async () => {
    wsState.storeFilled = false;
    wsState.replyScript = [
      { afterMs: 0, event: agentResponse(CHECKING_LINE) },
      { afterMs: 20, event: toolRequest("call_1") },
      { afterMs: 10, event: responseComplete() },
      { afterMs: 300, event: toolResponse("call_1") },
      { afterMs: 600, event: agentResponse(SOURCED_ANSWER) },
      { afterMs: 10, event: responseComplete() },
    ];

    const outcome = await runPalElevenLabsChatTurn({
      query: "Which quiet pubs near Soho have a beer garden?",
      ownerId: "11111111-1111-4111-8111-111111111111",
    });

    expect(outcome).toMatchObject({ ok: true, message: SOURCED_ANSWER });
  });

  it("ignores a turn end for the checking line that comes before its tool request", async () => {
    wsState.storeFilled = false;
    wsState.replyScript = [
      { afterMs: 0, event: agentResponse(CHECKING_LINE) },
      { afterMs: 10, event: responseComplete() },
      { afterMs: 20, event: toolRequest("call_1") },
      { afterMs: 300, event: toolResponse("call_1") },
      { afterMs: 600, event: agentResponse(SOURCED_ANSWER) },
      { afterMs: 10, event: responseComplete() },
    ];

    const outcome = await runPalElevenLabsChatTurn({
      query: "Which quiet pubs near Soho have a beer garden?",
      ownerId: "11111111-1111-4111-8111-111111111111",
    });

    expect(outcome).toMatchObject({ ok: true, message: SOURCED_ANSWER });
  });

  it("ignores a turn end between the tool response and the reply after it", async () => {
    wsState.storeFilled = false;
    wsState.replyScript = [
      { afterMs: 0, event: agentResponse(CHECKING_LINE) },
      { afterMs: 20, event: toolRequest("call_1") },
      { afterMs: 300, event: toolResponse("call_1") },
      { afterMs: 10, event: responseComplete() },
      { afterMs: 600, event: agentResponse(SOURCED_ANSWER) },
      { afterMs: 10, event: responseComplete() },
    ];

    const outcome = await runPalElevenLabsChatTurn({
      query: "Which quiet pubs near Soho have a beer garden?",
      ownerId: "11111111-1111-4111-8111-111111111111",
    });

    expect(outcome).toMatchObject({ ok: true, message: SOURCED_ANSWER });
  });

  describe("streaming the reply as the agent writes it", () => {
    type Progress = { type: "delta"; text: string } | { type: "reset" };
    const OWNER = "11111111-1111-4111-8111-111111111111";

    it("passes each text part of a reply that used no tool, and still returns the whole answer", async () => {
      const progress: Progress[] = [];
      wsState.replyScript = [
        { afterMs: 0, event: responsePart("start") },
        { afterMs: 5, event: responsePart("delta", "Hello.") },
        { afterMs: 5, event: responsePart("delta", " How can I help.") },
        { afterMs: 5, event: responsePart("stop") },
        { afterMs: 5, event: agentResponse("Hello. How can I help.") },
        { afterMs: 5, event: responseComplete() },
      ];

      const outcome = await runPalElevenLabsChatTurn({
        query: "Hello",
        ownerId: OWNER,
        onProgress: (event) => progress.push(event),
      });

      expect(progress).toEqual([
        { type: "delta", text: "Hello." },
        { type: "delta", text: " How can I help." },
      ]);
      expect(outcome).toMatchObject({ ok: true, message: "Hello. How can I help." });
    });

    it("clears a checking line when its tool runs, then streams the answer after it", async () => {
      const progress: Progress[] = [];
      wsState.storeFilled = false;
      wsState.replyScript = [
        { afterMs: 0, event: responsePart("start", "", "resp_1") },
        { afterMs: 5, event: responsePart("delta", "Let me check prices near Soho.", "resp_1") },
        { afterMs: 5, event: responsePart("stop", "", "resp_1") },
        { afterMs: 5, event: agentResponse(CHECKING_LINE) },
        { afterMs: 20, event: toolRequest("call_1") },
        { afterMs: 300, event: toolResponse("call_1") },
        { afterMs: 5, event: responsePart("start", "", "resp_2") },
        { afterMs: 5, event: responsePart("delta", "Two Soho picks", "resp_2") },
        { afterMs: 5, event: responsePart("delta", " with listed pints under five pounds.", "resp_2") },
        { afterMs: 5, event: responsePart("stop", "", "resp_2") },
        { afterMs: 5, event: agentResponse(SOURCED_ANSWER) },
        { afterMs: 5, event: responseComplete() },
      ];

      const outcome = await runPalElevenLabsChatTurn({
        query: "Which quiet pubs near Soho have a beer garden?",
        ownerId: OWNER,
        onProgress: (event) => progress.push(event),
      });

      expect(progress).toEqual([
        { type: "delta", text: "Let me check prices near Soho." },
        { type: "reset" },
        { type: "delta", text: "Two Soho picks" },
        { type: "delta", text: " with listed pints under five pounds." },
      ]);
      expect(outcome).toMatchObject({
        ok: true,
        message: SOURCED_ANSWER,
        cards: [expect.objectContaining({ venueId: "london-a" })],
      });
    });

    it("clears a reply that a newer reply replaces, even with no tool between", async () => {
      const progress: Progress[] = [];
      wsState.replyScript = [
        { afterMs: 0, event: responsePart("start", "", "resp_1") },
        { afterMs: 5, event: responsePart("delta", "First thought.", "resp_1") },
        { afterMs: 5, event: agentResponse("First thought.") },
        { afterMs: 50, event: responsePart("start", "", "resp_2") },
        { afterMs: 5, event: responsePart("delta", SOURCED_ANSWER, "resp_2") },
        { afterMs: 5, event: agentResponse(SOURCED_ANSWER) },
      ];

      const outcome = await runPalElevenLabsChatTurn({
        query: "quiet pubs",
        ownerId: OWNER,
        onProgress: (event) => progress.push(event),
      });

      expect(progress).toEqual([
        { type: "delta", text: "First thought." },
        { type: "reset" },
        { type: "delta", text: SOURCED_ANSWER },
      ]);
      expect(outcome).toMatchObject({ ok: true, message: SOURCED_ANSWER });
    });

    it("sends nothing for the greeting parts that arrive before the user's message", async () => {
      const progress: Progress[] = [];
      // The mock sends its greeting before the metadata. Parts for it must not stream.
      const outcome = await runPalElevenLabsChatTurn({
        query: "quiet pubs",
        ownerId: OWNER,
        onProgress: (event) => progress.push(event),
      });

      expect(progress).toEqual([]);
      expect(outcome).toMatchObject({ ok: true, message: SOURCED_ANSWER });
    });

    it("ends the turn and closes the agent when the caller goes away", async () => {
      const abort = new AbortController();
      wsState.replyScript = [{ afterMs: 5_000, event: agentResponse(SOURCED_ANSWER) }];

      const pending = runPalElevenLabsChatTurn({ query: "quiet pubs", ownerId: OWNER, signal: abort.signal });
      setTimeout(() => abort.abort(), 50);

      await expect(pending).resolves.toEqual({ ok: false, code: "TIMEOUT" });
    });
  });

  describe("on an agent that never sends agent_response_complete", () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("answers a tool turn once the reply has settled, without waiting for the turn end", async () => {
      wsState.storeFilled = false;
      wsState.replyScript = [
        { afterMs: 0, event: agentResponse(CHECKING_LINE) },
        { afterMs: 10, event: toolRequest("call_1") },
        { afterMs: 400, event: toolResponse("call_1") },
        { afterMs: 50, event: agentResponse(SOURCED_ANSWER) },
      ];

      const pending = runPalElevenLabsChatTurn({
        query: "Which quiet pubs near Soho have a beer garden?",
        ownerId: "11111111-1111-4111-8111-111111111111",
      });
      let settled = false;
      void pending.then(() => {
        settled = true;
      });
      await vi.advanceTimersByTimeAsync(1_000);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(settled).toBe(true);

      await expect(pending).resolves.toMatchObject({
        ok: true,
        message: SOURCED_ANSWER,
        conversationId: "conv_regression01",
        cards: [expect.objectContaining({ venueId: "london-a" })],
      });
    });

    it("answers a reply that used no tool within the settle window, not after a 4 s card wait", async () => {
      wsState.storeFilled = false;
      wsState.replyScript = [{ afterMs: 0, event: agentResponse("Hello. How can I help.") }];

      const pending = runPalElevenLabsChatTurn({
        query: "Hello",
        ownerId: "11111111-1111-4111-8111-111111111111",
      });
      await vi.advanceTimersByTimeAsync(1_500);

      await expect(pending).resolves.toMatchObject({ ok: true, message: "Hello. How can I help." });
    });

    it("keeps waiting when a checking line is followed by a tool request inside the window", async () => {
      wsState.storeFilled = false;
      wsState.replyScript = [
        { afterMs: 0, event: agentResponse(CHECKING_LINE) },
        { afterMs: 1_000, event: toolRequest("call_1") },
        { afterMs: 400, event: toolResponse("call_1") },
        { afterMs: 50, event: agentResponse(SOURCED_ANSWER) },
      ];

      const pending = runPalElevenLabsChatTurn({
        query: "Which quiet pubs near Soho have a beer garden?",
        ownerId: "11111111-1111-4111-8111-111111111111",
      });
      await vi.advanceTimersByTimeAsync(4_000);

      await expect(pending).resolves.toMatchObject({ ok: true, message: SOURCED_ANSWER });
    });

    it("finishes sooner once the turn-end event confirms the reply", async () => {
      wsState.replyScript = [
        { afterMs: 0, event: agentResponse(SOURCED_ANSWER) },
        { afterMs: 10, event: responseComplete() },
      ];

      const pending = runPalElevenLabsChatTurn({
        query: "Which quiet pubs near Soho have a beer garden?",
        ownerId: "11111111-1111-4111-8111-111111111111",
      });
      let settled = false;
      void pending.then(() => {
        settled = true;
      });
      await vi.advanceTimersByTimeAsync(600);

      expect(settled).toBe(true);
      await expect(pending).resolves.toMatchObject({ ok: true, message: SOURCED_ANSWER });
    });

    it("keeps the sourced reply when a completed tool response repeats", async () => {
      wsState.storeFilled = false;
      wsState.replyScript = [
        { afterMs: 0, event: toolRequest("call_1") },
        { afterMs: 400, event: toolResponse("call_1") },
        { afterMs: 50, event: agentResponse(SOURCED_ANSWER) },
        { afterMs: 10, event: toolResponse("call_1") },
        { afterMs: 10, event: responseComplete() },
      ];

      const pending = runPalElevenLabsChatTurn({
        query: "Which quiet pubs near Soho have a beer garden?",
        ownerId: "11111111-1111-4111-8111-111111111111",
      });
      await vi.advanceTimersByTimeAsync(22_000);

      await expect(pending).resolves.toMatchObject({
        ok: true,
        message: SOURCED_ANSWER,
        cards: toolTurnPayload.cards,
      });
    });

    it.each([
      {
        name: "the first response arrives after the reply",
        beforeReply: [toolRequest("call_1")],
        afterReply: toolResponse("call_1"),
      },
      {
        name: "the repeated response has no observed request",
        beforeReply: [toolResponse("call_1")],
        afterReply: toolResponse("call_1"),
      },
      {
        name: "the repeated response has no call id",
        beforeReply: [toolRequest(""), toolResponse("")],
        afterReply: toolResponse(""),
      },
      {
        name: "a new request reopens the completed call id",
        beforeReply: [toolRequest("call_1"), toolResponse("call_1"), toolRequest("call_1")],
        afterReply: toolResponse("call_1"),
      },
    ])("requires another reply when $name", async ({ beforeReply, afterReply }) => {
      wsState.replyScript = [
        ...beforeReply.map((event) => ({ afterMs: 10, event })),
        { afterMs: 10, event: agentResponse(CHECKING_LINE) },
        { afterMs: 10, event: afterReply },
        { afterMs: 10, event: responseComplete() },
      ];

      const pending = runPalElevenLabsChatTurn({
        query: "Which quiet pubs near Soho have a beer garden?",
        ownerId: "11111111-1111-4111-8111-111111111111",
      });
      await vi.advanceTimersByTimeAsync(22_000);

      await expect(pending).resolves.toEqual({ ok: false, code: "TIMEOUT" });
    });

    it("times out rather than answer with a checking line when no reply follows its tool", async () => {
      wsState.storeFilled = false;
      wsState.replyScript = [
        { afterMs: 0, event: agentResponse(CHECKING_LINE) },
        { afterMs: 10, event: toolRequest("call_1") },
        { afterMs: 400, event: toolResponse("call_1") },
      ];

      const pending = runPalElevenLabsChatTurn({
        query: "Which quiet pubs near Soho have a beer garden?",
        ownerId: "11111111-1111-4111-8111-111111111111",
      });
      await vi.advanceTimersByTimeAsync(22_000);

      await expect(pending).resolves.toEqual({ ok: false, code: "TIMEOUT" });
    });

    it("times out rather than answer with a checking line while its tool runs", async () => {
      wsState.storeFilled = false;
      wsState.replyScript = [
        { afterMs: 0, event: agentResponse(CHECKING_LINE) },
        { afterMs: 10, event: toolRequest("call_1") },
      ];

      const pending = runPalElevenLabsChatTurn({
        query: "Which quiet pubs near Soho have a beer garden?",
        ownerId: "11111111-1111-4111-8111-111111111111",
      });
      await vi.advanceTimersByTimeAsync(22_000);

      await expect(pending).resolves.toEqual({ ok: false, code: "TIMEOUT" });
    });
  });
});

describe("the signed URL a typed chat turn starts from", () => {
  beforeEach(() => {
    wsState.replyScript = null;
    vi.stubEnv("ELEVENLABS_API_KEY", "test-key");
    vi.stubEnv("ELEVENLABS_PUB_PAL_AGENT_ID", "agent-id");
    vi.stubGlobal("WebSocket", MockElevenLabsWebSocket);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("gives up on a provider that never answers instead of running past the route limit", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: unknown, init?: { signal?: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
          }),
      ),
    );

    const pending = runPalElevenLabsChatTurn({
      query: "quiet pubs",
      ownerId: "11111111-1111-4111-8111-111111111111",
    });
    await vi.advanceTimersByTimeAsync(8_500);

    await expect(pending).resolves.toEqual({ ok: false, code: "PROVIDER_UNAVAILABLE" });
  });

  it("refuses a provider answer that holds no conversation id", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ signed_url: "wss://api.elevenlabs.io/v1/convai/conversation?agent_id=a" })),
    );

    await expect(
      runPalElevenLabsChatTurn({ query: "quiet pubs", ownerId: "11111111-1111-4111-8111-111111111111" }),
    ).resolves.toEqual({ ok: false, code: "PROVIDER_UNAVAILABLE" });
  });
});

describe("private typed Pal failure diagnostics", () => {
  let lines: string[];

  function failures(): Array<Record<string, unknown>> {
    return lines.map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((record) => record.event === "pub_pal.chat_failed");
  }

  beforeEach(() => {
    lines = [];
    vi.spyOn(console, "log").mockImplementation((line: unknown) => {
      if (typeof line === "string") lines.push(line);
    });
    wsState.socketsOpened = 0;
    wsState.replyScript = null;
    wsState.storeFilled = true;
    storeMocks.registerPubPalToolTurn.mockReset();
    storeMocks.registerPubPalToolTurn.mockResolvedValue(undefined);
    storeMocks.readOwnedPubPalToolTurn.mockReset();
    storeMocks.readOwnedPubPalToolTurn.mockResolvedValue(null);
    vi.mocked(readPubPalToolTurn).mockReset();
    vi.mocked(readPubPalToolTurn).mockImplementation(async () =>
      wsState.storeFilled ? toolTurnPayload : { ...toolTurnPayload, cards: [], toolsUsed: [] },
    );
    fenceMocks.resolvePubPalFenceIntent.mockReset();
    fenceMocks.resolvePubPalFenceIntent.mockResolvedValue({ fenced: false, sobrietyOnly: false });
    vi.stubEnv("ELEVENLABS_API_KEY", "test-key");
    vi.stubEnv("ELEVENLABS_PUB_PAL_AGENT_ID", "agent-id");
    vi.stubGlobal("WebSocket", MockElevenLabsWebSocket);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("records the signed-URL refusal once with safe fields and keeps the public failure unchanged", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("sensitive upstream body", { status: 401 })));
    const result = await runPalElevenLabsChatTurn({
      query: "Hello. Can you help me plan a quiet night in Soho for two?",
      ownerId: "11111111-1111-4111-8111-111111111111",
    });
    expect(result).toEqual({ ok: false, code: "PROVIDER_UNAVAILABLE" });
    expect(wsState.socketsOpened).toBe(0);
    expect(failures()).toEqual([{
      level: "warn",
      event: "pub_pal.chat_failed",
      code: "PROVIDER_UNAVAILABLE",
      stage: "signed_url",
      reason: "http",
      durationMs: expect.any(Number),
      ts: expect.any(Number),
    }]);
  });

  it.each(["no_session", "unreachable"] as const)("records the existing %s reason without exposing upstream data", async (reason) => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      if (reason === "unreachable") throw new Error("provider payload, credentials, transcript and headers");
      return Response.json({ signed_url: "wss://voice.example/?conversation_signature=private-value" });
    }));
    await expect(runPalElevenLabsChatTurn({ query: "quiet pubs", ownerId: "private-owner" })).resolves.toEqual({
      ok: false, code: "PROVIDER_UNAVAILABLE",
    });
    expect(failures()).toEqual([{
      level: "warn", event: "pub_pal.chat_failed", code: "PROVIDER_UNAVAILABLE",
      stage: "signed_url", reason, durationMs: expect.any(Number), ts: expect.any(Number),
    }]);
  });

  it("records the bounded signed-URL failure without guessing a transport cause", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.stubGlobal("fetch", vi.fn((_url: unknown, init?: { signal?: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("private transport error")));
      }),
    ));
    const pending = runPalElevenLabsChatTurn({ query: "quiet pubs", ownerId: "private-owner" });
    await vi.advanceTimersByTimeAsync(8_000);
    await expect(pending).resolves.toEqual({ ok: false, code: "PROVIDER_UNAVAILABLE" });
    expect(failures()).toEqual([{
      level: "warn", event: "pub_pal.chat_failed", code: "PROVIDER_UNAVAILABLE",
      stage: "signed_url", reason: "unreachable", durationMs: 8_000, ts: expect.any(Number),
    }]);
  });

  it("records context failure without exposing the stored turn or error", async () => {
    storeMocks.readOwnedPubPalToolTurn.mockRejectedValueOnce(new Error("private context"));
    await expect(runPalElevenLabsChatTurn({ query: "quiet pubs", ownerId: "private-owner", threadId: "conv_regression01" })).resolves.toEqual({
      ok: false, code: "UNAVAILABLE",
    });
    expect(failures()).toEqual([{
      level: "warn", event: "pub_pal.chat_failed", code: "UNAVAILABLE",
      stage: "context", durationMs: expect.any(Number), ts: expect.any(Number),
    }]);
  });

  it("records registration failure without exposing the provider session or store error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ signed_url: SIGNED_URL })));
    storeMocks.registerPubPalToolTurn.mockRejectedValueOnce(new Error("private registration"));
    await expect(runPalElevenLabsChatTurn({ query: "quiet pubs", ownerId: "private-owner" })).resolves.toEqual({
      ok: false, code: "UNAVAILABLE",
    });
    expect(failures()).toEqual([{
      level: "warn", event: "pub_pal.chat_failed", code: "UNAVAILABLE",
      stage: "registration", durationMs: expect.any(Number), ts: expect.any(Number),
    }]);
  });

  it.each(["error", "close"] as const)("records socket %s once when later close events repeat", async (event) => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ signed_url: SIGNED_URL })));
    vi.stubGlobal("WebSocket", class extends EventTarget {
      constructor() {
        super();
        queueMicrotask(() => {
          this.dispatchEvent(new Event(event));
          this.dispatchEvent(new Event("close"));
        });
      }
      send(): void {}
      close(): void { this.dispatchEvent(new Event("close")); }
    });
    await expect(runPalElevenLabsChatTurn({ query: "quiet pubs", ownerId: "private-owner" })).resolves.toEqual({
      ok: false, code: "PROVIDER_UNAVAILABLE",
    });
    expect(failures()).toEqual([{
      level: "warn", event: "pub_pal.chat_failed", code: "PROVIDER_UNAVAILABLE",
      stage: event === "error" ? "socket_error" : "socket_close", durationMs: expect.any(Number), ts: expect.any(Number),
    }]);
  });

  it("records the unchanged reply deadline without logging the unfinished conversation", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ signed_url: SIGNED_URL })));
    wsState.replyScript = [];
    const pending = runPalElevenLabsChatTurn({ query: "quiet pubs", ownerId: "private-owner" });
    await vi.advanceTimersByTimeAsync(22_000);
    await expect(pending).resolves.toEqual({ ok: false, code: "TIMEOUT" });
    expect(failures()).toEqual([{
      level: "warn", event: "pub_pal.chat_failed", code: "TIMEOUT",
      stage: "deadline", durationMs: 22_000, ts: expect.any(Number),
    }]);
  });

  it("records result-store failure without logging the provider answer", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ signed_url: SIGNED_URL })));
    vi.mocked(readPubPalToolTurn).mockRejectedValueOnce(new Error("private result store"));
    const pending = runPalElevenLabsChatTurn({ query: "quiet pubs", ownerId: "private-owner" });
    await vi.advanceTimersByTimeAsync(400);
    await expect(pending).resolves.toEqual({ ok: false, code: "UNAVAILABLE" });
    expect(failures()).toEqual([{
      level: "warn", event: "pub_pal.chat_failed", code: "UNAVAILABLE",
      stage: "tool_result", durationMs: 400, ts: expect.any(Number),
    }]);
  });

  it("keeps normal caller cancellation silent", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ signed_url: SIGNED_URL })));
    wsState.replyScript = [];
    const abort = new AbortController();
    const pending = runPalElevenLabsChatTurn({ query: "quiet pubs", ownerId: "private-owner", signal: abort.signal });
    await vi.advanceTimersByTimeAsync(0);
    abort.abort();
    await expect(pending).resolves.toEqual({ ok: false, code: "TIMEOUT" });
    expect(failures()).toEqual([]);
  });

  it("does not warn when a cancelled caller later receives a signed-URL refusal", async () => {
    const abort = new AbortController();
    vi.stubGlobal("fetch", vi.fn(async () => {
      abort.abort();
      return new Response("private body", { status: 401 });
    }));
    await expect(runPalElevenLabsChatTurn({ query: "quiet pubs", ownerId: "private-owner", signal: abort.signal })).resolves.toEqual({
      ok: false, code: "PROVIDER_UNAVAILABLE",
    });
    expect(failures()).toEqual([]);
  });

  it("keeps a successful answer out of failure diagnostics", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ signed_url: SIGNED_URL })));
    const pending = runPalElevenLabsChatTurn({ query: "quiet pubs", ownerId: "private-owner" });
    await vi.advanceTimersByTimeAsync(400);
    await expect(pending).resolves.toMatchObject({ ok: true, message: SOURCED_ANSWER });
    expect(failures()).toEqual([]);
  });
});
