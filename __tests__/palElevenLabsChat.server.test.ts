import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PubPalToolTurn } from "@/lib/pubPalToolTurnStore";

const PAL_GREETING = "Hello, I'm your Pub Pal. What kind of night are you planning?";
const SOURCED_ANSWER = "Listed pint at The Crown.";

const wsState = vi.hoisted(() => ({
  lastInitPayload: null as unknown,
  userMessageText: null as string | null,
  userMessageCount: 0,
  repeatMetadata: false,
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
          conversation_initiation_metadata_event: { conversation_id: "conv_regression01" },
        }),
      });
      if (wsState.repeatMetadata) {
        this.emit("message", {
          data: JSON.stringify({
            type: "conversation_initiation_metadata",
            conversation_initiation_metadata_event: { conversation_id: "conv_replayed02" },
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
import { readPubPalToolTurn } from "@/lib/pubPalToolTurnStore";
import { offlineFetch, requestUrl } from "@/evals/pal/offlineFetch";

describe("runPalElevenLabsChatTurn", () => {
  beforeEach(() => {
    wsState.lastInitPayload = null;
    wsState.userMessageText = null;
    wsState.userMessageCount = 0;
    wsState.repeatMetadata = false;
    wsState.answer = SOURCED_ANSWER;
    wsState.responseDelayMs = 0;
    vi.mocked(readPubPalToolTurn).mockResolvedValue(toolTurnPayload);
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
    storeMocks.registerPubPalToolTurn.mockReset();
    storeMocks.registerPubPalToolTurn.mockResolvedValue(undefined);
    storeMocks.readOwnedPubPalToolTurn.mockReset();
    storeMocks.readOwnedPubPalToolTurn.mockResolvedValue(null);
    fenceMocks.resolvePubPalFenceIntent.mockReset();
    fenceMocks.resolvePubPalFenceIntent.mockResolvedValue({ fenced: false, sobrietyOnly: false });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("returns sourced wording after the query and ignores the configured greeting", async () => {
    const query = "Which pubs near Soho have a pint under £5?";
    const outcome = await runPalElevenLabsChatTurn({
      query,
      ownerId: "11111111-1111-4111-8111-111111111111",
    });

    expect(outcome).toMatchObject({
      ok: true,
      message: "1 pick from the listed pubs, each with its source. Listed pint at The Crown.",
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

  it("uses tool-authored wording even when the provider adds an unsupported price", async () => {
    wsState.answer = "The Crown is £3.40 and open until 3 am.";
    const outcome = await runPalElevenLabsChatTurn({
      query: "Which pubs near Soho have a pint under £5?",
      ownerId: "11111111-1111-4111-8111-111111111111",
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
    wsState.answer = "Camden's cheapest pint is £3.40. Open the pub.";
    const pending = runPalElevenLabsChatTurn({ ownerId: "11111111-1111-4111-8111-111111111111", query: "Cheapest pint in Camden" });
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
    const pending = runPalElevenLabsChatTurn({ ownerId: "11111111-1111-4111-8111-111111111111", query: "Plan a crawl in Soho for 4" });
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
    wsState.answer = "The cafe has wifi and a free desk.";
    const pending = runPalElevenLabsChatTurn({ ownerId: "11111111-1111-4111-8111-111111111111", query: "Somewhere to work with wifi in Angel" });
    await vi.advanceTimersByTimeAsync(4_200);
    const outcome = await pending;
    expect(outcome).toMatchObject({ ok: true, cards: [], proposals: [], toolsUsed: ["find_desk"] });
    if (!outcome.ok) throw new Error("Expected an honest empty answer");
    expect(outcome.message).toContain("No seat data yet");
    expect(outcome.message).not.toBe(wsState.answer);
  });

  it("ends a hung owned-thread read inside the total response budget and ignores its late result", async () => {
    vi.useFakeTimers();
    let resolveOwnedRead!: (turn: unknown) => void;
    storeMocks.readOwnedPubPalToolTurn.mockImplementationOnce(() => new Promise<unknown>((resolve) => {
      resolveOwnedRead = resolve;
    }));
    let outcome: Awaited<ReturnType<typeof runPalElevenLabsChatTurn>> | undefined;
    void runPalElevenLabsChatTurn({
      ownerId: "11111111-1111-4111-8111-111111111111",
      threadId: "conv_previous01",
      query: "Cheapest pint in Camden",
    }).then((result) => { outcome = result; });
    await vi.advanceTimersByTimeAsync(27_999);
    expect(outcome).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(outcome).toEqual({ ok: false, code: "TIMEOUT" });

    resolveOwnedRead({ ...toolTurnPayload, query: "An earlier private ask" });
    await vi.advanceTimersByTimeAsync(0);
    expect(fenceMocks.resolvePubPalFenceIntent).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(storeMocks.registerPubPalToolTurn).not.toHaveBeenCalled();
    expect(wsState.lastInitPayload).toBeNull();
    expect(wsState.userMessageText).toBeNull();
  });

  it.each([true, false])("times out the shared prelude before a late fenced=%s result", async (fenced) => {
    vi.useFakeTimers();
    storeMocks.readOwnedPubPalToolTurn.mockImplementationOnce(() => new Promise<unknown>((resolve) => {
      setTimeout(() => resolve(null), 27_000);
    }));
    fenceMocks.resolvePubPalFenceIntent.mockImplementationOnce(() => new Promise((resolve) => {
      setTimeout(() => resolve({ fenced, sobrietyOnly: false }), 4_000);
    }));
    let outcome: Awaited<ReturnType<typeof runPalElevenLabsChatTurn>> | undefined;
    void runPalElevenLabsChatTurn({
      ownerId: "11111111-1111-4111-8111-111111111111",
      threadId: "conv_previous01",
      query: "Which pub is quiet?",
    }).then((result) => { outcome = result; });
    await vi.advanceTimersByTimeAsync(27_999);
    expect(outcome).toBeUndefined();
    expect(fenceMocks.resolvePubPalFenceIntent).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(outcome).toEqual({ ok: false, code: "TIMEOUT" });
    await vi.advanceTimersByTimeAsync(3_000);
    expect(outcome).toEqual({ ok: false, code: "TIMEOUT" });
    expect(fetch).not.toHaveBeenCalled();
    expect(storeMocks.registerPubPalToolTurn).not.toHaveBeenCalled();
    expect(wsState.lastInitPayload).toBeNull();
    expect(wsState.userMessageText).toBeNull();
  });

  it("counts owned-thread latency inside the existing signed-URL and socket budget", async () => {
    vi.useFakeTimers();
    storeMocks.readOwnedPubPalToolTurn.mockImplementationOnce(() => new Promise<unknown>((resolve) => {
      setTimeout(() => resolve(null), 10_000);
    }));
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => {
      setTimeout(() => resolve(Response.json({ signed_url: "wss://convai.elevenlabs.io/mock-session" })), 4_000);
    })));
    wsState.responseDelayMs = 60_000;
    let outcome: Awaited<ReturnType<typeof runPalElevenLabsChatTurn>> | undefined;
    void runPalElevenLabsChatTurn({
      ownerId: "11111111-1111-4111-8111-111111111111",
      threadId: "conv_previous01",
      query: "Cheapest pint in Camden",
    }).then((result) => { outcome = result; });
    await vi.advanceTimersByTimeAsync(27_999);
    expect(outcome).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(outcome).toEqual({ ok: false, code: "TIMEOUT" });
  });

  it("binds and sends the ask once when metadata repeats during registration", async () => {
    vi.useFakeTimers();
    wsState.repeatMetadata = true;
    storeMocks.registerPubPalToolTurn.mockImplementationOnce(() => new Promise<void>((resolve) => {
      setTimeout(resolve, 10);
    }));
    const pending = runPalElevenLabsChatTurn({
      ownerId: "11111111-1111-4111-8111-111111111111",
      query: "quiet pubs",
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(storeMocks.registerPubPalToolTurn).toHaveBeenCalledTimes(1);
    expect(storeMocks.registerPubPalToolTurn).toHaveBeenCalledWith("conv_regression01", expect.objectContaining({
      ownerId: "11111111-1111-4111-8111-111111111111",
      query: "quiet pubs",
    }));
    await vi.advanceTimersByTimeAsync(10);
    expect(await pending).toMatchObject({ ok: true, conversationId: "conv_regression01" });
    expect(wsState.userMessageCount).toBe(1);
    expect(wsState.userMessageText).toBe("quiet pubs");
  });

  it("does not send the ask when registration resolves after the response deadline", async () => {
    vi.useFakeTimers();
    let resolveRegistration!: () => void;
    storeMocks.registerPubPalToolTurn.mockImplementationOnce(() => new Promise<void>((resolve) => {
      resolveRegistration = () => resolve();
    }));
    let outcome: Awaited<ReturnType<typeof runPalElevenLabsChatTurn>> | undefined;
    void runPalElevenLabsChatTurn({
      ownerId: "11111111-1111-4111-8111-111111111111",
      query: "quiet pubs",
    }).then((result) => { outcome = result; });
    await vi.advanceTimersByTimeAsync(28_000);
    expect(storeMocks.registerPubPalToolTurn).toHaveBeenCalledTimes(1);
    expect(outcome).toEqual({ ok: false, code: "TIMEOUT" });
    resolveRegistration();
    await vi.advanceTimersByTimeAsync(0);
    expect(wsState.userMessageCount).toBe(0);
    expect(wsState.userMessageText).toBeNull();
  });

  it("ends a hung signed-URL request before the websocket budget starts", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn<typeof fetch>((_input, init) => new Promise((_, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    })));
    let outcome: Awaited<ReturnType<typeof runPalElevenLabsChatTurn>> | undefined;
    void runPalElevenLabsChatTurn({ ownerId: "11111111-1111-4111-8111-111111111111", query: "Cheapest pint in Camden" }).then((result) => { outcome = result; });
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
    void runPalElevenLabsChatTurn({ ownerId: "11111111-1111-4111-8111-111111111111", query: "Cheapest pint in Camden" }).then((result) => { outcome = result; });
    await vi.advanceTimersByTimeAsync(28_000);
    expect(outcome).toEqual({ ok: false, code: "TIMEOUT" });
  });
});
