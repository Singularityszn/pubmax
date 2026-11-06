import type Anthropic from "@anthropic-ai/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Map Ask's model loop on Claude (lib/ask/modelLoop.ts), with the OpenRouter
// fallback beside it. The Claude call is a fake passed as `claude`, and the
// tools are a fake too, so no test reaches a model or a data source.

const { runAskToolMock } = vi.hoisted(() => ({ runAskToolMock: vi.fn() }));

vi.mock("@/lib/ask/tools", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ask/tools")>()),
  runAskTool: runAskToolMock,
}));

import type { ClaudeClient } from "@/lib/claudeClient.server";
import { askModelConfigured, runAskModelLoop } from "@/lib/ask/modelLoop";
import { askToolDefinitions, type AskToolContext, type AskToolResult } from "@/lib/ask/tools";
import type { AskToolName } from "@/lib/ask/types";

const ctx: AskToolContext = { cityId: "london", query: "quiet pub in Soho", skipModel: true };

type Round = { content: Anthropic.ContentBlock[]; stop_reason: Anthropic.StopReason; throws?: Error };

function text(value: string): Anthropic.TextBlock {
  return { type: "text", text: value, citations: null } as Anthropic.TextBlock;
}

function toolUse(id: string, name: string, input: unknown): Anthropic.ToolUseBlock {
  return { type: "tool_use", id, name, input } as Anthropic.ToolUseBlock;
}

function fakeClaude(rounds: Round[]): { client: ClaudeClient; bodies: Anthropic.MessageStreamParams[] } {
  const bodies: Anthropic.MessageStreamParams[] = [];
  const client: ClaudeClient = {
    stream(body) {
      // A snapshot: the loop appends to the same messages array later.
      bodies.push(structuredClone(body));
      const round = rounds.shift();
      return {
        on() {
          return this;
        },
        async finalMessage() {
          if (!round) throw new Error("no scripted round left");
          if (round.throws) throw round.throws;
          return {
            id: "msg_test",
            type: "message",
            role: "assistant",
            model: "claude-haiku-5-5",
            content: round.content,
            stop_reason: round.stop_reason,
            stop_sequence: null,
            usage: { input_tokens: 40, output_tokens: 12, cache_read_input_tokens: 900, cache_creation_input_tokens: 0 },
          } as unknown as Anthropic.Message;
        },
      };
    },
  };
  return { client, bodies };
}

function toolResult(tool: AskToolName, answerHint: string): AskToolResult {
  return { ok: true, tool, data: null, provenance: [], cards: [], proposals: [], answerHint };
}

/** The tool_result blocks of a sent user message. */
function sentResults(body: Anthropic.MessageStreamParams): Anthropic.ToolResultBlockParam[] {
  const last = body.messages.at(-1)!;
  expect(last.role).toBe("user");
  return last.content as Anthropic.ToolResultBlockParam[];
}

beforeEach(() => {
  vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
  vi.stubEnv("OPENROUTER_API_KEY", undefined);
  vi.stubEnv("ASK_CLAUDE_MODEL", undefined);
  runAskToolMock.mockReset().mockImplementation(async (name: AskToolName) => toolResult(name, `${name} ran.`));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("Ask model loop on Claude", () => {
  it("is configured by either key", () => {
    expect(askModelConfigured()).toBe(true);
    vi.stubEnv("ANTHROPIC_API_KEY", " ");
    expect(askModelConfigured()).toBe(false);
    vi.stubEnv("OPENROUTER_API_KEY", "or-key");
    expect(askModelConfigured()).toBe(true);
  });

  it("asks Claude with the cached prompt, every Ask tool and low effort, and runs the tool it picks", async () => {
    const { client, bodies } = fakeClaude([
      { content: [toolUse("tu_1", "search_venues", { query: "quiet", limit: 3 })], stop_reason: "tool_use" },
      { content: [text("Here you go.")], stop_reason: "end_turn" },
    ]);

    const outcome = await runAskModelLoop({ query: "quiet pub in Soho", ctx, claude: client });

    expect(outcome?.toolResults.map((result) => result.tool)).toEqual(["search_venues"]);
    expect(runAskToolMock).toHaveBeenCalledWith("search_venues", { query: "quiet", limit: 3 }, { ...ctx, skipModel: true });
    expect(bodies).toHaveLength(2);
    const first = bodies[0]!;
    expect(first.model).toBe("claude-haiku-5-5");
    expect(first.system).toEqual([
      expect.objectContaining({ type: "text", cache_control: { type: "ephemeral" } }),
    ]);
    expect(first.cache_control).toEqual({ type: "ephemeral" });
    expect(first.output_config).toEqual({ effort: "low" });
    expect(first).not.toHaveProperty("temperature");
    expect(first).not.toHaveProperty("tool_choice");
    expect(first.tools?.map((tool) => (tool as Anthropic.Tool).name)).toEqual(
      askToolDefinitions().map((definition) => definition.function.name),
    );
    expect(first.messages).toEqual([{ role: "user", content: "quiet pub in Soho" }]);

    // The second round carries the whole assistant turn and its result back.
    const second = bodies[1]!;
    expect(second.messages[1]).toEqual({
      role: "assistant",
      content: [toolUse("tu_1", "search_venues", { query: "quiet", limit: 3 })],
    });
    const [result] = sentResults(second);
    expect(result).toMatchObject({ type: "tool_result", tool_use_id: "tu_1" });
    expect(JSON.parse(String(result!.content))).toMatchObject({ ok: true, answerHint: "search_venues ran." });
  });

  it("uses the model the deployment names for Ask", async () => {
    vi.stubEnv("ASK_CLAUDE_MODEL", "claude-sonnet-5-5");
    const { client, bodies } = fakeClaude([{ content: [text("Nothing to look up.")], stop_reason: "end_turn" }]);

    await runAskModelLoop({ query: "hello", ctx, claude: client });

    expect(bodies[0]!.model).toBe("claude-sonnet-5-5");
  });

  it("starts the conversation with the user and keeps earlier turns", async () => {
    const { client, bodies } = fakeClaude([{ content: [text("Fine.")], stop_reason: "end_turn" }]);

    await runAskModelLoop({
      query: "cheaper",
      turns: [
        { role: "assistant", content: "Welcome." },
        { role: "user", content: "pub in Soho" },
        { role: "assistant", content: "Two picks." },
      ],
      ctx,
      claude: client,
    });

    expect(bodies[0]!.messages).toEqual([
      { role: "user", content: "pub in Soho" },
      { role: "assistant", content: "Two picks." },
      { role: "user", content: "cheaper" },
    ]);
  });

  it("answers a tool off the allowlist with an error and runs nothing", async () => {
    const { client, bodies } = fakeClaude([
      { content: [toolUse("tu_1", "delete_everything", {})], stop_reason: "tool_use" },
      { content: [text("Sorry.")], stop_reason: "end_turn" },
    ]);

    const outcome = await runAskModelLoop({ query: "do it", ctx, claude: client });

    expect(outcome).toEqual({ toolResults: [] });
    expect(runAskToolMock).not.toHaveBeenCalled();
    expect(JSON.parse(String(sentResults(bodies[1]!)[0]!.content))).toEqual({ error: "Tool not allowlisted." });
  });

  it("runs three tools a round and gives every further call an error result", async () => {
    const { client, bodies } = fakeClaude([
      {
        content: [
          toolUse("a", "search_venues", {}),
          toolUse("b", "whats_on", {}),
          toolUse("c", "city_status", {}),
          toolUse("d", "search_venues", {}),
        ],
        stop_reason: "tool_use",
      },
      { content: [text("Done.")], stop_reason: "end_turn" },
    ]);

    const outcome = await runAskModelLoop({ query: "everything", ctx, claude: client });

    expect(outcome?.toolResults).toHaveLength(3);
    const results = sentResults(bodies[1]!);
    expect(results.map((result) => result.tool_use_id)).toEqual(["a", "b", "c", "d"]);
    expect(results.map((result) => result.is_error === true)).toEqual([false, false, false, true]);
  });

  it("stops after three model rounds", async () => {
    const round = (): Round => ({ content: [toolUse(`tu_${Math.random()}`, "search_venues", {})], stop_reason: "tool_use" });
    const { client, bodies } = fakeClaude([round(), round(), round(), round()]);

    const outcome = await runAskModelLoop({ query: "loop", ctx, claude: client });

    expect(bodies).toHaveLength(3);
    expect(outcome?.toolResults).toHaveLength(3);
  });

  it("returns null when Claude fails before any tool ran, so the deterministic path answers", async () => {
    const { client } = fakeClaude([{ content: [], stop_reason: "end_turn", throws: new Error("overloaded") }]);

    expect(await runAskModelLoop({ query: "quiet pub", ctx, claude: client })).toBeNull();
  });

  it("keeps the tools that ran when a later Claude round fails", async () => {
    const { client } = fakeClaude([
      { content: [toolUse("tu_1", "search_venues", {})], stop_reason: "tool_use" },
      { content: [], stop_reason: "end_turn", throws: new Error("overloaded") },
    ]);

    const outcome = await runAskModelLoop({ query: "quiet pub", ctx, claude: client });

    expect(outcome?.toolResults.map((result) => result.tool)).toEqual(["search_venues"]);
  });

  it("logs each call's token counts with no prompt text", async () => {
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((line: unknown) => {
      lines.push(String(line));
    });
    const { client } = fakeClaude([{ content: [text("Fine.")], stop_reason: "end_turn" }]);

    await runAskModelLoop({ query: "a secret question", ctx, claude: client, traceRoute: "api/ask" });

    const usage = lines.map((line) => JSON.parse(line) as Record<string, unknown>).filter((record) => record.event === "claude.usage");
    expect(usage).toEqual([
      expect.objectContaining({
        route: "api/ask",
        model: "claude-haiku-5-5",
        input: 40,
        output: 12,
        cacheRead: 900,
        cacheWrite: 0,
      }),
    ]);
    expect(lines.join("\n")).not.toContain("a secret question");
  });
});

describe("Ask model loop fallback to OpenRouter", () => {
  function openRouterFetch(): { fetchImpl: typeof fetch; urls: string[] } {
    const urls: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      urls.push(String(input));
      return new Response(
        JSON.stringify({ choices: [{ message: { role: "assistant", content: "Nothing to look up." } }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };
    return { fetchImpl, urls };
  }

  it("calls OpenRouter exactly as before when there is no Claude key", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", undefined);
    vi.stubEnv("OPENROUTER_API_KEY", "or-key");
    const { fetchImpl, urls } = openRouterFetch();

    const outcome = await runAskModelLoop({ query: "hello", ctx, fetchImpl });

    expect(outcome).toEqual({ toolResults: [] });
    expect(urls).toEqual(["https://openrouter.ai/api/v1/chat/completions"]);
  });

  it("does not touch OpenRouter when Claude is configured", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "or-key");
    const { fetchImpl, urls } = openRouterFetch();
    const { client, bodies } = fakeClaude([{ content: [text("Fine.")], stop_reason: "end_turn" }]);

    await runAskModelLoop({ query: "hello", ctx, fetchImpl, claude: client });

    expect(bodies).toHaveLength(1);
    expect(urls).toEqual([]);
  });

  it("keeps an explicit OpenRouter key on OpenRouter", async () => {
    const { fetchImpl, urls } = openRouterFetch();
    const { client, bodies } = fakeClaude([]);

    await runAskModelLoop({ query: "hello", ctx, fetchImpl, apiKey: "or-key", claude: client });

    expect(bodies).toEqual([]);
    expect(urls).toHaveLength(1);
  });

  it("returns null with neither key", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", undefined);
    const { fetchImpl, urls } = openRouterFetch();

    expect(await runAskModelLoop({ query: "hello", ctx, fetchImpl })).toBeNull();
    expect(urls).toEqual([]);
  });
});
