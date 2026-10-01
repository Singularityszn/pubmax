import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PubPalToolTurn } from "@/lib/pubPalToolTurnStore";

const PAL_GREETING = "Hello, I'm your Pub Pal. What kind of night are you planning?";
const SOURCED_ANSWER = "Listed pint at The Crown.";

const wsState = vi.hoisted(() => ({
  lastInitPayload: null as unknown,
  userMessageText: null as string | null,
  answer: "Listed pint at The Crown.",
  responseDelayMs: 0,
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
      const reply = () => {
        this.emit("message", {
          data: JSON.stringify({
            type: "agent_response",
            agent_response_event: { agent_response: wsState.answer },
          }),
        });
      };
      if (wsState.responseDelayMs > 0) setTimeout(reply, wsState.responseDelayMs);
      else queueMicrotask(reply);
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

const toolTurnPayload: PubPalToolTurn = {
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
        provenance: { label: "Listed menu", kind: "directory", url: "https://example.com/menu" },
      },
    ],
    proposals: [],
    hints: [SOURCED_ANSWER],
    toolsUsed: ["search_venues"],
  };

vi.mock("@/lib/pubPalToolTurnStore", () => ({
  registerPubPalToolTurn: vi.fn(async () => {}),
  readPubPalToolTurn: vi.fn(async () => toolTurnPayload),
  consumePubPalToolTurn: vi.fn(async () => toolTurnPayload),
}));

import { runPalElevenLabsChatTurn } from "@/lib/palElevenLabsChat.server";
import { consumePubPalToolTurn, readPubPalToolTurn } from "@/lib/pubPalToolTurnStore";
import { offlineFetch, requestUrl } from "@/evals/pal/offlineFetch";

describe("runPalElevenLabsChatTurn", () => {
  beforeEach(() => {
    wsState.lastInitPayload = null;
    wsState.userMessageText = null;
    wsState.answer = SOURCED_ANSWER;
    wsState.responseDelayMs = 0;
    vi.mocked(readPubPalToolTurn).mockResolvedValue(toolTurnPayload);
    vi.mocked(consumePubPalToolTurn).mockResolvedValue(toolTurnPayload);
    vi.stubEnv("ELEVENLABS_API_KEY", "test-key");
    vi.stubEnv("ELEVENLABS_PUB_PAL_AGENT_ID", "agent-id");
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input, init) =>
        requestUrl(input).startsWith("https://api.elevenlabs.io/")
          ? Response.json({ signed_url: "wss://convai.elevenlabs.io/mock-session" })
          : offlineFetch(input, init),
      ),
    );
    vi.stubEnv("OPENROUTER_API_KEY", "");
    vi.stubEnv("TYPESAFE_API_KEY", "");
    vi.stubGlobal("WebSocket", MockElevenLabsWebSocket);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("returns sourced wording after the query and ignores the configured greeting", async () => {
    const outcome = await runPalElevenLabsChatTurn({
      query: "Which pubs near Soho have a pint under £5?",
    });

    expect(outcome).toMatchObject({
      ok: true,
      message: "1 pick from the listed pubs, each with its source. Listed pint at The Crown.",
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

  it("uses tool-authored wording even when the provider adds an unsupported price", async () => {
    wsState.answer = "The Crown is £3.40 and open until 3 am.";
    const outcome = await runPalElevenLabsChatTurn({
      query: "Which pubs near Soho have a pint under £5?",
    });
    expect(outcome).toMatchObject({
      ok: true,
      message: "1 pick from the listed pubs, each with its source. Listed pint at The Crown.",
      cards: [{ venueId: "london-a", price: 4.8 }],
    });
  });

  it("recovers sourced Camden cards when the provider reply has no correlated receipt", async () => {
    vi.useFakeTimers();
    vi.mocked(readPubPalToolTurn).mockResolvedValue(null);
    vi.mocked(consumePubPalToolTurn).mockResolvedValue(null);
    wsState.answer = "Camden's cheapest pint is £3.40. Open the pub.";
    const pending = runPalElevenLabsChatTurn({ query: "Cheapest pint in Camden" });
    await vi.advanceTimersByTimeAsync(4_200);
    const outcome = await pending;
    expect(outcome).toMatchObject({ ok: true, toolsUsed: ["cheapest_pint_near"] });
    if (!outcome.ok) throw new Error("Expected a grounded answer");
    expect(outcome.cards.length).toBeGreaterThan(0);
    expect(outcome.cards[0].provenance?.kind).toBe("directory");
    expect(outcome.message).not.toBe(wsState.answer);
  });

  it("recovers a three-stop Plan handoff from the registry when the receipt is empty", async () => {
    vi.useFakeTimers();
    const empty = { ...toolTurnPayload, cards: [], hints: [], toolsUsed: [] };
    vi.mocked(readPubPalToolTurn).mockResolvedValue(empty);
    vi.mocked(consumePubPalToolTurn).mockResolvedValue(empty);
    const pending = runPalElevenLabsChatTurn({ query: "Plan a crawl in Soho for 4" });
    await vi.advanceTimersByTimeAsync(4_200);
    const outcome = await pending;
    expect(outcome).toMatchObject({ ok: true, toolsUsed: ["propose_plan"] });
    if (!outcome.ok) throw new Error("Expected a grounded plan proposal");
    const draft = outcome.proposals.find((proposal) => proposal.kind === "draft_plan");
    expect(draft).toMatchObject({ kind: "draft_plan", label: "Open in Plan" });
    expect(draft?.kind === "draft_plan" && draft.stopIds.length).toBe(3);
    expect(outcome.message).toContain("Open in Plan");
  });

  it("returns the registry's honest empty answer instead of unsourced provider facts", async () => {
    vi.useFakeTimers();
    vi.mocked(readPubPalToolTurn).mockResolvedValue(null);
    vi.mocked(consumePubPalToolTurn).mockResolvedValue(null);
    wsState.answer = "The cafe has wifi and a free desk.";
    const pending = runPalElevenLabsChatTurn({ query: "Somewhere to work with wifi in Angel" });
    await vi.advanceTimersByTimeAsync(4_200);
    const outcome = await pending;
    expect(outcome).toMatchObject({ ok: true, cards: [], proposals: [], toolsUsed: ["find_desk"] });
    if (!outcome.ok) throw new Error("Expected an honest empty answer");
    expect(outcome.message).toContain("No seat data yet");
    expect(outcome.message).not.toBe(wsState.answer);
  });

  it("ends a hung signed-URL request before the websocket budget starts", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn<typeof fetch>((_input, init) => new Promise((_, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    })));
    let outcome: Awaited<ReturnType<typeof runPalElevenLabsChatTurn>> | undefined;
    void runPalElevenLabsChatTurn({ query: "Cheapest pint in Camden" }).then((result) => { outcome = result; });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(outcome).toEqual({ ok: false, code: "PROVIDER_UNAVAILABLE" });
  });

  it("counts signed-URL latency inside the total server response window", async () => {
    vi.useFakeTimers();
    wsState.responseDelayMs = 26_000;
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(() => new Promise((resolve) => {
      setTimeout(() => resolve(Response.json({ signed_url: "wss://convai.elevenlabs.io/mock-session" })), 4_000);
    })));
    let outcome: Awaited<ReturnType<typeof runPalElevenLabsChatTurn>> | undefined;
    void runPalElevenLabsChatTurn({ query: "Cheapest pint in Camden" }).then((result) => { outcome = result; });
    await vi.advanceTimersByTimeAsync(28_000);
    expect(outcome).toEqual({ ok: false, code: "TIMEOUT" });
  });
});
