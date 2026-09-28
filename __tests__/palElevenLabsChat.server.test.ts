import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const PAL_GREETING = "Hello, I'm your Pub Pal. What kind of night are you planning?";
const SOURCED_ANSWER = "Two Soho picks with listed pints under five pounds.";

const wsState = vi.hoisted(() => ({
  lastInitPayload: null as unknown,
  userMessageText: null as string | null,
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
          conversation_initiation_metadata_event: { conversation_id: "conv-regression" },
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

vi.mock("@/lib/pubPalLlmFence", () => ({
  resolvePubPalFenceIntent: vi.fn(async () => ({ fenced: false, sobrietyOnly: false })),
  pubPalGetHomeRegisterAnswer: vi.fn(),
}));

vi.mock("@/lib/pubPalToolTurnStore", () => ({
  registerPubPalToolTurn: vi.fn(async () => {}),
  consumePubPalToolTurn: vi.fn(async () => ({
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
  })),
}));

import { runPalElevenLabsChatTurn } from "@/lib/palElevenLabsChat.server";

describe("runPalElevenLabsChatTurn", () => {
  beforeEach(() => {
    wsState.lastInitPayload = null;
    wsState.userMessageText = null;
    vi.stubEnv("ELEVENLABS_API_KEY", "test-key");
    vi.stubEnv("ELEVENLABS_PUB_PAL_AGENT_ID", "agent-id");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ signed_url: "wss://convai.elevenlabs.io/mock-session" }),
      ),
    );
    vi.stubGlobal("WebSocket", MockElevenLabsWebSocket);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("returns the post-query agent reply, not the configured first_message greeting", async () => {
    const outcome = await runPalElevenLabsChatTurn({
      query: "Which pubs near Soho have a pint under £5?",
    });

    expect(outcome).toMatchObject({
      ok: true,
      message: SOURCED_ANSWER,
      conversationId: "conv-regression",
    });
    expect(outcome.ok === true && outcome.message).not.toBe(PAL_GREETING);
    expect(wsState.userMessageText).toBe("Which pubs near Soho have a pint under £5?");
    expect(outcome.ok === true && outcome.cards.length).toBeGreaterThan(0);

    const init = wsState.lastInitPayload as {
      conversation_config_override?: { agent?: { first_message?: string } };
    };
    expect(init?.conversation_config_override?.agent?.first_message).toBe("");
  });
});
