import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const PAL_GREETING = "Hello, I'm your Pub Pal. What kind of night are you planning?";
const SOURCED_ANSWER = "Two Soho picks with listed pints under five pounds.";
const CHECKING_LINE = "Let me check prices near Soho.";

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

const wsState = vi.hoisted(() => ({
  lastInitPayload: null as unknown,
  userMessageText: null as string | null,
  /** What the agent sends after the user message. Null sends only the answer. */
  replyScript: null as ScriptedEvent[] | null,
}));

class MockElevenLabsWebSocket {
  static OPEN = 1;
  private listeners: Record<string, Array<(event: unknown) => void>> = {};

  constructor(url: string) {
    void url;
    queueMicrotask(() => {
      this.emit("open", {});
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
        this.emit("message", {
          data: JSON.stringify({
            type: "agent_response",
            agent_response_event: { agent_response: SOURCED_ANSWER },
          }),
        });
      });
    }
  }

  close(): void {
    // noop
  }

  private emit(type: string, event: unknown): void {
    for (const listener of this.listeners[type] ?? []) listener(event);
  }
}

const fenceMocks = vi.hoisted(() => ({
  resolvePubPalFenceIntent: vi.fn<
    (message: string, turns: Array<{ role: string; content: string }>) => Promise<{
      fenced: boolean;
      sobrietyOnly: boolean;
    }>
  >(async () => ({ fenced: false, sobrietyOnly: false })),
}));

vi.mock("@/lib/pubPalLlmFence", () => ({
  resolvePubPalFenceIntent: fenceMocks.resolvePubPalFenceIntent,
  pubPalGetHomeRegisterAnswer: vi.fn(() => "Getting Home has the trains."),
}));

const toolTurnPayload = {
    query: "Which pubs near Soho have a pint under £5?",
    cityId: "london",
    turns: [],
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
  readPubPalToolTurn: vi.fn(async () => toolTurnPayload),
  readOwnedPubPalToolTurn: storeMocks.readOwnedPubPalToolTurn,
}));

import { runPalElevenLabsChatTurn } from "@/lib/palElevenLabsChat.server";

describe("runPalElevenLabsChatTurn", () => {
  beforeEach(() => {
    wsState.lastInitPayload = null;
    wsState.userMessageText = null;
    wsState.replyScript = null;
    vi.stubEnv("ELEVENLABS_API_KEY", "test-key");
    vi.stubEnv("ELEVENLABS_PUB_PAL_AGENT_ID", "agent-id");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ signed_url: "wss://convai.elevenlabs.io/mock-session" }),
      ),
    );
    vi.stubGlobal("WebSocket", MockElevenLabsWebSocket);
    storeMocks.registerPubPalToolTurn.mockClear();
    storeMocks.readOwnedPubPalToolTurn.mockReset();
    storeMocks.readOwnedPubPalToolTurn.mockResolvedValue(null);
    fenceMocks.resolvePubPalFenceIntent.mockReset();
    fenceMocks.resolvePubPalFenceIntent.mockResolvedValue({ fenced: false, sobrietyOnly: false });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("returns the post-query agent reply, not the configured first_message greeting", async () => {
    const query = "Which pubs near Soho have a pint under £5?";
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
    expect(wsState.userMessageText).toBe(query);
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
        "My earlier asks in this chat, oldest first:",
        "- a pub for six",
        "- quiet pubs in Soho",
        "Now: what about somewhere cheaper there?",
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
    expect(wsState.userMessageText).toBe("quiet pubs");
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
    expect(wsState.userMessageText).toBe("what about somewhere cheaper there?");
  });

  it("never reads a thread id that is not a Pub Pal conversation id", async () => {
    await runPalElevenLabsChatTurn({
      query: "quiet pubs",
      ownerId: "11111111-1111-4111-8111-111111111111",
      threadId: "not-a-conversation",
    });

    expect(storeMocks.readOwnedPubPalToolTurn).not.toHaveBeenCalled();
    expect(wsState.userMessageText).toBe("quiet pubs");
  });
  it("asks for tool events so it can tell the checking line from the answer", async () => {
    await runPalElevenLabsChatTurn({
      query: "quiet pubs",
      ownerId: "11111111-1111-4111-8111-111111111111",
    });

    const init = wsState.lastInitPayload as {
      conversation_config_override?: { conversation?: { client_events?: string[] } };
    };
    expect(init?.conversation_config_override?.conversation?.client_events).toEqual(
      expect.arrayContaining(["agent_response", "agent_tool_request", "agent_tool_response"]),
    );
  });

  it("answers with the reply after the tool, not the checking line said before it", async () => {
    wsState.replyScript = [
      { afterMs: 0, event: agentResponse(CHECKING_LINE) },
      { afterMs: 50, event: toolRequest("call_1") },
      { afterMs: 300, event: toolResponse("call_1") },
      { afterMs: 50, event: agentResponse(SOURCED_ANSWER) },
    ];

    const outcome = await runPalElevenLabsChatTurn({
      query: "Which pubs near Soho have a pint under £5?",
      ownerId: "11111111-1111-4111-8111-111111111111",
    });

    expect(outcome).toMatchObject({ ok: true, message: SOURCED_ANSWER });
  });

  it("treats a checking line that arrives after its tool request as interim", async () => {
    wsState.replyScript = [
      { afterMs: 0, event: toolRequest("call_1") },
      { afterMs: 10, event: agentResponse(CHECKING_LINE) },
      { afterMs: 300, event: toolResponse("call_1") },
      { afterMs: 50, event: agentResponse(SOURCED_ANSWER) },
    ];

    const outcome = await runPalElevenLabsChatTurn({
      query: "Which pubs near Soho have a pint under £5?",
      ownerId: "11111111-1111-4111-8111-111111111111",
    });

    expect(outcome).toMatchObject({ ok: true, message: SOURCED_ANSWER });
  });

  it("waits through a chain of two tools, each with its own checking line", async () => {
    wsState.replyScript = [
      { afterMs: 0, event: agentResponse(CHECKING_LINE) },
      { afterMs: 20, event: toolRequest("call_1") },
      { afterMs: 100, event: toolResponse("call_1") },
      { afterMs: 20, event: agentResponse("Now the trains.") },
      { afterMs: 20, event: toolRequest("call_2") },
      { afterMs: 100, event: toolResponse("call_2") },
      { afterMs: 20, event: agentResponse(SOURCED_ANSWER) },
    ];

    const outcome = await runPalElevenLabsChatTurn({
      query: "Which pubs near Soho have a pint under £5?",
      ownerId: "11111111-1111-4111-8111-111111111111",
    });

    expect(outcome).toMatchObject({ ok: true, message: SOURCED_ANSWER });
  });
});
