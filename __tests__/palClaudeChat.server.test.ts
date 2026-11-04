import type Anthropic from "@anthropic-ai/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Typed Pub Pal chat on Claude (lib/palClaudeChat.server.ts). The SDK call is
// a fake passed through the dependencies object, so no test reaches a model.

const fenceMocks = vi.hoisted(() => ({
  resolvePubPalFenceIntent: vi.fn(async () => ({ fenced: false, sobrietyOnly: false })),
}));

vi.mock("@/lib/pubPalLlmFence", () => ({
  resolvePubPalFenceIntent: fenceMocks.resolvePubPalFenceIntent,
  pubPalGetHomeRegisterAnswer: vi.fn(() => "Getting Home has the trains."),
}));

const storedTurn = {
  query: "a quiet pub in Soho",
  cityId: "london" as const,
  turns: [],
  summary: "",
  expiresAt: Date.now() + 60_000,
  cards: [{ key: "v1", venueId: "london-a", title: "The Crown", place: "Soho", note: "Listed pint.", price: 4.8 }],
  proposals: [],
  hints: [],
  toolsUsed: ["search_venues"],
};

const storeMocks = vi.hoisted(() => ({
  registerPubPalToolTurn: vi.fn<(conversationId: string, input: unknown) => Promise<void>>(async () => {}),
  readOwnedPubPalToolTurn: vi.fn<(conversationId: string, ownerId: string) => Promise<unknown>>(async () => null),
  readPubPalToolTurn: vi.fn<(conversationId: string) => Promise<unknown>>(async () => null),
}));

vi.mock("@/lib/pubPalToolTurnStore", () => ({
  registerPubPalToolTurn: storeMocks.registerPubPalToolTurn,
  readOwnedPubPalToolTurn: storeMocks.readOwnedPubPalToolTurn,
  readPubPalToolTurn: storeMocks.readPubPalToolTurn,
}));

vi.mock("@/lib/palTaste.server", () => ({ readPalTaste: vi.fn(async () => null) }));

import {
  PAL_CLAUDE_DEFAULT_MODEL,
  palClaudeConfigured,
  runPalClaudeChatTurn,
  type PalClaudeClient,
} from "@/lib/palClaudeChat.server";
import { pubPalTypedChatSystemPrompt } from "@/lib/palVoicePrompt.mjs";
import { PUB_PAL_TOOL_NAMES } from "@/lib/pubPalToolCatalog.mjs";
import { isPalLocalThreadId } from "@/lib/pubPalConversationId";
import { __resetPubPalStore } from "@/lib/pubPalStore";

const OWNER = "11111111-1111-4111-8111-111111111111";

type Round = {
  content: Anthropic.ContentBlock[];
  stop_reason: Anthropic.StopReason;
  deltas?: string[];
  throws?: Error;
};

function text(value: string): Anthropic.TextBlock {
  return { type: "text", text: value, citations: null } as Anthropic.TextBlock;
}

function toolUse(id: string, name: string, input: Record<string, unknown>): Anthropic.ToolUseBlock {
  return { type: "tool_use", id, name, input } as Anthropic.ToolUseBlock;
}

function fakeClient(rounds: Round[]): { client: PalClaudeClient; bodies: Anthropic.MessageStreamParams[] } {
  const bodies: Anthropic.MessageStreamParams[] = [];
  const client: PalClaudeClient = {
    stream(body) {
      // A snapshot: the runner appends to the same messages array later.
      bodies.push(structuredClone(body));
      const round = rounds.shift();
      const listeners: Array<(delta: string) => void> = [];
      return {
        on(_event: "text", listener: (delta: string) => void) {
          listeners.push(listener);
          return this;
        },
        async finalMessage() {
          if (!round) throw new Error("no scripted round left");
          for (const delta of round.deltas ?? []) for (const listener of listeners) listener(delta);
          if (round.throws) throw round.throws;
          return {
            id: "msg_test",
            type: "message",
            role: "assistant",
            model: PAL_CLAUDE_DEFAULT_MODEL,
            content: round.content,
            stop_reason: round.stop_reason,
            stop_sequence: null,
            usage: { input_tokens: 10, output_tokens: 5 },
          } as unknown as Anthropic.Message;
        },
      };
    },
  };
  return { client, bodies };
}

describe("runPalClaudeChatTurn", () => {
  beforeEach(() => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    fenceMocks.resolvePubPalFenceIntent.mockReset().mockResolvedValue({ fenced: false, sobrietyOnly: false });
    storeMocks.registerPubPalToolTurn.mockReset().mockResolvedValue(undefined);
    storeMocks.readOwnedPubPalToolTurn.mockReset().mockResolvedValue(null);
    storeMocks.readPubPalToolTurn.mockReset().mockResolvedValue(storedTurn);
  });

  afterEach(() => {
    __resetPubPalStore();
    vi.unstubAllEnvs();
  });

  it("is configured by the Anthropic key alone", () => {
    expect(palClaudeConfigured()).toBe(true);
    vi.stubEnv("ANTHROPIC_API_KEY", " ");
    expect(palClaudeConfigured()).toBe(false);
  });

  it("asks Claude with the typed Pal prompt, every Pal tool and low effort, and returns its reply", async () => {
    const { client, bodies } = fakeClient([{ content: [text("Hey. Where are you heading tonight?")], stop_reason: "end_turn" }]);

    const outcome = await runPalClaudeChatTurn({ query: "evening", ownerId: OWNER }, undefined, { client });

    expect(outcome).toMatchObject({ ok: true, message: "Hey. Where are you heading tonight?" });
    expect(bodies).toHaveLength(1);
    const body = bodies[0]!;
    expect(body.model).toBe("claude-haiku-5-5");
    expect(body.system).toBe(pubPalTypedChatSystemPrompt());
    expect(body.output_config).toEqual({ effort: "low" });
    expect(body).not.toHaveProperty("temperature");
    expect(body).not.toHaveProperty("thinking");
    expect(body.tools?.map((tool) => (tool as Anthropic.Tool).name)).toEqual([...PUB_PAL_TOOL_NAMES]);
    expect(body.messages).toHaveLength(1);
    expect(String(body.messages[0]!.content).split("\n").at(-1)).toBe("Current user message: evening");
  });

  it("uses the model the deployment names", async () => {
    vi.stubEnv("PUB_PAL_CLAUDE_MODEL", "claude-sonnet-5-5");
    const { client, bodies } = fakeClient([{ content: [text("Hey.")], stop_reason: "end_turn" }]);

    await runPalClaudeChatTurn({ query: "evening", ownerId: OWNER }, undefined, { client });

    expect(bodies[0]!.model).toBe("claude-sonnet-5-5");
  });

  it("gives each tool its catalog arguments, with no provider correlation field", async () => {
    const { client, bodies } = fakeClient([{ content: [text("Hey.")], stop_reason: "end_turn" }]);
    await runPalClaudeChatTurn({ query: "evening", ownerId: OWNER }, undefined, { client });

    const tools = (bodies[0]!.tools ?? []) as Anthropic.Tool[];
    const memory = tools.find((tool) => tool.name === "propose_memory");
    expect(Object.keys(memory?.input_schema.properties ?? {})).toEqual(["kind", "value"]);
    expect(JSON.stringify(tools)).not.toContain("conversation_id");
  });

  it("runs a tool in its own thread, sends every result back in one message, and answers with the cards", async () => {
    const { client, bodies } = fakeClient([
      {
        content: [toolUse("tu_1", "search_venues", { query: "quiet pub in Soho", limit: 2 })],
        stop_reason: "tool_use",
      },
      { content: [text("The Crown is your quiet one.")], stop_reason: "end_turn" },
    ]);
    const runTool = vi.fn(async () => ({ ok: true, answerHint: "1 sourced result(s).", cards: storedTurn.cards }));

    const outcome = await runPalClaudeChatTurn({ query: "a quiet pub in Soho", ownerId: OWNER }, undefined, { client, runTool });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(isPalLocalThreadId(outcome.conversationId)).toBe(true);
    expect(storeMocks.registerPubPalToolTurn).toHaveBeenCalledWith(
      outcome.conversationId,
      expect.objectContaining({ query: "a quiet pub in Soho", ownerId: OWNER }),
    );
    expect(runTool).toHaveBeenCalledWith("search_venues", { query: "quiet pub in Soho", limit: 2 }, outcome.conversationId);
    expect(outcome.message).toBe("The Crown is your quiet one.");
    expect(outcome.cards).toEqual(storedTurn.cards);
    expect(outcome.toolsUsed).toEqual(["search_venues"]);

    const second = bodies[1]!.messages;
    expect(second.map((message) => message.role)).toEqual(["user", "assistant", "user"]);
    expect(second[2]!.content).toEqual([
      expect.objectContaining({ type: "tool_result", tool_use_id: "tu_1" }),
    ]);
  });

  it("carries the caller's own earlier asks into a new thread for the follow-up", async () => {
    const thread = "conv_palAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    storeMocks.readOwnedPubPalToolTurn.mockResolvedValue({ ...storedTurn, query: "pubs in Soho", turns: [] });
    const { client, bodies } = fakeClient([{ content: [text("Cheaper ones coming up.")], stop_reason: "end_turn" }]);

    const outcome = await runPalClaudeChatTurn({ query: "cheaper ones", threadId: thread, ownerId: OWNER }, undefined, { client });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(isPalLocalThreadId(outcome.conversationId)).toBe(true);
    expect(outcome.conversationId).not.toBe(thread);
    expect(storeMocks.registerPubPalToolTurn).toHaveBeenCalledWith(
      outcome.conversationId,
      expect.objectContaining({ query: "cheaper ones", turns: [{ role: "user", content: "pubs in Soho" }] }),
    );
    expect(String(bodies[0]!.messages[0]!.content)).toContain("- pubs in Soho");
  });

  it("ends the turn when the caller leaves during a slow tool, without waiting for it", async () => {
    const { client, bodies } = fakeClient([
      { content: [toolUse("tu_1", "journey", { query: "to Soho" })], stop_reason: "tool_use" },
    ]);
    const caller = new AbortController();
    let toolStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      toolStarted = resolve;
    });

    const turn = runPalClaudeChatTurn({ query: "how do I get to Soho", ownerId: OWNER, signal: caller.signal }, undefined, {
      client,
      runTool: () => {
        toolStarted();
        // A tool that never answers.
        return new Promise(() => {});
      },
    });
    await started;
    caller.abort();

    // The chat deadline is 22 seconds away. The turn must end long before it.
    const stillRunning = new Promise((resolve) => setTimeout(() => resolve("still running"), 1_000));
    await expect(Promise.race([turn, stillRunning])).resolves.toEqual({ ok: false, code: "TIMEOUT" });
    expect(bodies).toHaveLength(1);
  });

  it("streams the reply, and clears text written before a tool call", async () => {
    const { client } = fakeClient([
      { content: [text("Checking."), toolUse("tu_1", "whats_on", { query: "quiz" })], stop_reason: "tool_use", deltas: ["Checking."] },
      { content: [text("A quiz at The Crown.")], stop_reason: "end_turn", deltas: ["A quiz ", "at The Crown."] },
    ]);
    const events: unknown[] = [];

    await runPalClaudeChatTurn(
      { query: "a quiz tonight", ownerId: OWNER, onProgress: (event) => events.push(event) },
      undefined,
      { client, runTool: async () => ({ ok: true, answerHint: "One quiz." }) },
    );

    expect(events).toEqual([
      { type: "delta", text: "Checking." },
      { type: "reset" },
      { type: "delta", text: "A quiz " },
      { type: "delta", text: "at The Crown." },
    ]);
  });

  it("starts no tool when the caller leaves while the model is still answering", async () => {
    const caller = new AbortController();
    const client: PalClaudeClient = {
      stream() {
        return {
          on() {
            return this;
          },
          async finalMessage() {
            // The caller leaves after the model has decided on a tool, before it runs.
            caller.abort();
            return {
              id: "msg_test",
              type: "message",
              role: "assistant",
              model: PAL_CLAUDE_DEFAULT_MODEL,
              content: [toolUse("tu_1", "journey", { query: "to Soho" })],
              stop_reason: "tool_use",
              stop_sequence: null,
              usage: { input_tokens: 10, output_tokens: 5 },
            } as unknown as Anthropic.Message;
          },
        };
      },
    };
    // Were it started, this tool would fail after the turn had already ended.
    const runTool = vi.fn(
      () => new Promise<Record<string, unknown>>((_, reject) => setTimeout(() => reject(new Error("CityMCP down")), 50)),
    );
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    try {
      const outcome = await runPalClaudeChatTurn(
        { query: "how do I get to Soho", ownerId: OWNER, signal: caller.signal },
        undefined,
        { client, runTool },
      );
      await new Promise((resolve) => setTimeout(resolve, 150));

      expect(outcome).toEqual({ ok: false, code: "TIMEOUT" });
      expect(runTool).not.toHaveBeenCalled();
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it("leaves no unhandled rejection when a tool fails after its caller left", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    try {
      const { client } = fakeClient([
        { content: [toolUse("tu_1", "journey", { query: "to Soho" })], stop_reason: "tool_use" },
      ]);
      const caller = new AbortController();
      let toolStarted!: () => void;
      const started = new Promise<void>((resolve) => {
        toolStarted = resolve;
      });
      const turn = runPalClaudeChatTurn({ query: "how do I get to Soho", ownerId: OWNER, signal: caller.signal }, undefined, {
        client,
        runTool: () => {
          toolStarted();
          return new Promise((_, reject) => setTimeout(() => reject(new Error("CityMCP down")), 50));
        },
      });
      await started;
      caller.abort();

      expect(await turn).toEqual({ ok: false, code: "TIMEOUT" });
      // Past the tool's late failure.
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it("tells the model a failed tool failed, and still answers", async () => {
    const { client, bodies } = fakeClient([
      { content: [toolUse("tu_1", "journey", { query: "to Soho" })], stop_reason: "tool_use" },
      { content: [text("I could not check the journey just now.")], stop_reason: "end_turn" },
    ]);

    const outcome = await runPalClaudeChatTurn({ query: "how do I get to Soho", ownerId: OWNER }, undefined, {
      client,
      runTool: async () => {
        throw new Error("CityMCP down");
      },
    });

    expect(outcome).toMatchObject({ ok: true, message: "I could not check the journey just now." });
    expect(bodies[1]!.messages[2]!.content).toEqual([
      expect.objectContaining({ type: "tool_result", tool_use_id: "tu_1", is_error: true }),
    ]);
  });

  it("keeps the reply when the stored cards cannot be read", async () => {
    storeMocks.readPubPalToolTurn.mockRejectedValue(new Error("store down"));
    const { client } = fakeClient([{ content: [text("The Crown is your quiet one.")], stop_reason: "end_turn" }]);

    const outcome = await runPalClaudeChatTurn({ query: "a quiet pub in Soho", ownerId: OWNER }, undefined, { client });

    expect(outcome).toMatchObject({ ok: true, message: "The Crown is your quiet one.", cards: [] });
  });

  it("asks no model when the safety fence answers", async () => {
    fenceMocks.resolvePubPalFenceIntent.mockResolvedValue({ fenced: true, sobrietyOnly: false });
    const { client, bodies } = fakeClient([]);

    const outcome = await runPalClaudeChatTurn({ query: "am I ok to drive home", ownerId: OWNER }, undefined, { client });

    expect(outcome).toMatchObject({ ok: true, message: "Getting Home has the trains." });
    expect(bodies).toHaveLength(0);
  });

  it("fails closed on a refusal, a provider error, or a loop that never replies", async () => {
    const refusal = fakeClient([{ content: [], stop_reason: "refusal" }]);
    expect(await runPalClaudeChatTurn({ query: "a pub", ownerId: OWNER }, undefined, { client: refusal.client }))
      .toEqual({ ok: false, code: "PROVIDER_UNAVAILABLE" });

    const broken = fakeClient([{ content: [], stop_reason: "end_turn", throws: new Error("529 overloaded") }]);
    expect(await runPalClaudeChatTurn({ query: "a pub", ownerId: OWNER }, undefined, { client: broken.client }))
      .toEqual({ ok: false, code: "PROVIDER_UNAVAILABLE" });

    const looping = fakeClient(
      Array.from({ length: 4 }, (_, index) => ({
        content: [toolUse(`tu_${index}`, "whats_on", { query: "quiz" })],
        stop_reason: "tool_use" as const,
      })),
    );
    expect(
      await runPalClaudeChatTurn({ query: "a quiz", ownerId: OWNER }, undefined, {
        client: looping.client,
        runTool: async () => ({ ok: true }),
      }),
    ).toEqual({ ok: false, code: "PROVIDER_UNAVAILABLE" });
    expect(looping.bodies).toHaveLength(4);
  });

  it("calls nothing without a key", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const outcome = await runPalClaudeChatTurn({ query: "a pub", ownerId: OWNER });
    expect(outcome).toEqual({ ok: false, code: "UNAVAILABLE" });
    expect(storeMocks.registerPubPalToolTurn).not.toHaveBeenCalled();
  });
});
