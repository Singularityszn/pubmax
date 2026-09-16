import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Only the AI SDK telemetry bridge entry point is mocked (to assert the
// bridge registered); the provider, span processor and exporter wiring run
// real, against a capturing exporter.
vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return { ...actual, registerTelemetry: vi.fn() };
});

// The ask tool runner is mocked so a test can make one tool throw mid-loop.
vi.mock("@/lib/ask/tools", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ask/tools")>();
  return { ...actual, runAskTool: vi.fn(actual.runAskTool) };
});

import { context, trace } from "@opentelemetry/api";
import type { ReadableSpan, SpanExporter } from "@opentelemetry/sdk-trace-base";
import { registerTelemetry } from "ai";

import { runAskModelLoop } from "@/lib/ask/modelLoop";
import { runAskTool } from "@/lib/ask/tools";
import {
  flushArizeTracing,
  registerArizeTracing,
  traceArizeModelCall,
  traceArizeModelLoop,
} from "@/lib/observability/arize";
import { OpenAISocialPostModerationAdapter } from "@/lib/socialPostModeration";

class CapturingExporter implements SpanExporter {
  readonly spans: ReadableSpan[] = [];

  export(
    spans: ReadableSpan[],
    resultCallback: (result: { code: number; error?: Error }) => void,
  ): void {
    this.spans.push(...spans);
    resultCallback({ code: 0 });
  }

  async shutdown(): Promise<void> {}
  async forceFlush(): Promise<void> {}
}

// SpanStatusCode.OK is 1 and SpanStatusCode.ERROR is 2 in @opentelemetry/api.
const STATUS_OK = 1;
const STATUS_ERROR = 2;

// ONE exporter for the whole file: @vercel/otel installs the global tracer
// provider once per process, so a second registration with a new exporter
// would silently route every later span to the first one.
const exporter = new CapturingExporter();

beforeAll(async () => {
  process.env.ARIZE_API_KEY = "test-key";
  process.env.ARIZE_SPACE_KEY = "test-space";
  process.env.ARIZE_PROJECT_NAME = "Pubmaxx";
  await registerArizeTracing({ exporter });
});

afterAll(() => {
  delete process.env.ARIZE_API_KEY;
  delete process.env.ARIZE_SPACE_KEY;
  delete process.env.ARIZE_PROJECT_NAME;
});

describe("Arize tracing registers with keys present", () => {
  it("bridges the AI SDK v7 telemetry integration on registration", async () => {
    // Self-contained: hook-time mock timing must not decide this test, so
    // the call count is read before and after a fresh registration.
    const before = vi.mocked(registerTelemetry).mock.calls.length;
    await registerArizeTracing({ exporter });
    expect(vi.mocked(registerTelemetry).mock.calls.length).toBeGreaterThan(before);
  });

  it("exports an OpenInference LLM span with model, tokens, route and masked IO", async () => {
    const result = await traceArizeModelCall({
      route: "api/heritage",
      model: "anthropic/claude-sonnet-4-5",
      provider: "openrouter",
      prompt: "QUESTION: pubs near bob@example.com asked by @karan",
      invocationParameters: { temperature: 0 },
      call: async (span) => {
        span?.setUsage({ promptTokens: 12, completionTokens: 34, totalTokens: 46 });
        span?.setOutput("Email bob@example.com or ping @karan");
        return "narrated";
      },
    });

    expect(result).toBe("narrated");
    await flushArizeTracing();
    const span = exporter.spans.find(
      (s) => s.attributes["metadata.route"] === "api/heritage",
    );
    expect(span).toBeDefined();
    expect(span!.name).toBe("chat anthropic/claude-sonnet-4-5 api/heritage");
    const s = span!;
    expect(s.attributes["openinference.span.kind"]).toBe("LLM");
    expect(s.attributes["llm.model_name"]).toBe("anthropic/claude-sonnet-4-5");
    expect(s.attributes["llm.token_count.prompt"]).toBe(12);
    expect(s.attributes["llm.token_count.completion"]).toBe(34);
    expect(s.attributes["llm.token_count.total"]).toBe(46);
    expect(s.attributes["metadata.route"]).toBe("api/heritage");
    expect(s.attributes["metadata.provider"]).toBe("openrouter");
    expect(s.attributes["llm.invocation_parameters"]).toBe(
      JSON.stringify({ temperature: 0 }),
    );
    // Latency is the span duration: the span must have real timing. OTel
    // records timing as high-resolution [seconds, nanoseconds] pairs.
    const toMs = (hrTime: readonly [number, number]): number =>
      hrTime[0] * 1000 + hrTime[1] / 1_000_000;
    expect(toMs(s.endTime)).toBeGreaterThan(toMs(s.startTime));
    // Masking happened before export, on both prompt and completion.
    expect(String(s.attributes["input.value"])).not.toContain("bob@example.com");
    expect(String(s.attributes["input.value"])).toContain("[email]");
    expect(String(s.attributes["input.value"])).toContain("@[handle]");
    expect(String(s.attributes["output.value"])).not.toContain("bob@example.com");
    expect(String(s.attributes["output.value"])).toContain("@[handle]");
    // The span routed to the captain's AX project.
    expect(s.resource.attributes["openinference.project.name"]).toBe("Pubmaxx");
    expect(s.status.code).toBe(STATUS_OK);
  });

  it("ends a failing model call with an ERROR status and still exports it", async () => {
    await expect(
      traceArizeModelCall({
        route: "moderation/avatar",
        model: "omni-moderation-latest",
        provider: "openai",
        call: async () => {
          throw new Error("provider 503");
        },
      }),
    ).rejects.toThrow("provider 503");

    await flushArizeTracing();
    const span = exporter.spans.find(
      (s) => s.name === "chat omni-moderation-latest moderation/avatar",
    );
    expect(span).toBeDefined();
    expect(span!.status.code).toBe(STATUS_ERROR);
    expect(span!.events.some((event) => event.name === "exception")).toBe(true);
  });

  it("builds an agent trace: rounds and tool calls under one AGENT span", async () => {
    const result = await traceArizeModelLoop({
      route: "api/ask",
      model: "anthropic/claude-sonnet-4-5",
      provider: "openrouter",
      prompt: "cheap pints near @karan in Camden",
      run: async ({ modelRound, toolCall }) => {
        const round = modelRound({ prompt: "round messages" });
        round?.setUsage({ promptTokens: 5, completionTokens: 7, totalTokens: 12 });
        round?.setOutput("tool call");
        round?.end();
        const tool = toolCall({ name: "propose_map_action", input: { area: "Camden" } });
        tool?.setOutput(JSON.stringify({ ok: true, answerHint: "moved" }));
        tool?.end();
        return "done";
      },
    });

    expect(result).toBe("done");
    await flushArizeTracing();
    const agent = exporter.spans.find((s) => s.name === "agent api/ask");
    const llm = exporter.spans.find(
      (s) => s.name === "chat anthropic/claude-sonnet-4-5 api/ask",
    );
    const tool = exporter.spans.find(
      (s) => s.name === "tool propose_map_action api/ask",
    );
    expect(agent).toBeDefined();
    expect(llm).toBeDefined();
    expect(tool).toBeDefined();
    expect(agent?.name).toBe("agent api/ask");
    expect(agent?.attributes["metadata.route"]).toBe("api/ask");
    expect(agent?.attributes["llm.model_name"]).toBe("anthropic/claude-sonnet-4-5");
    expect(llm?.parentSpanContext?.spanId).toBe(agent?.spanContext().spanId);
    expect(tool?.parentSpanContext?.spanId).toBe(agent?.spanContext().spanId);
    expect(tool?.attributes["tool.name"]).toBe("propose_map_action");
    expect(llm?.attributes["metadata.provider"]).toBe("openrouter");
    expect(tool?.attributes["metadata.provider"]).toBe("openrouter");
    expect(String(agent?.attributes["input.value"])).toContain("@[handle]");
    expect(String(agent?.attributes["input.value"])).not.toContain("@karan");
  });

  it("roots a request's top span when the active parent is a dropped framework span", async () => {
    // Inside a server request the active span is the Next.js HTTP span, which
    // the OpenInference filter never exports: a span parented to it would
    // reach AX with no trace root.
    const http = trace.getTracer("next.js").startSpan("POST /api/heritage");
    await context.with(trace.setSpan(context.active(), http), () =>
      Promise.all([
        traceArizeModelCall({
          route: "api/root-heritage",
          model: "anthropic/claude-sonnet-4-5",
          call: async () => "answer",
        }),
        traceArizeModelLoop({
          route: "api/root-ask",
          model: "anthropic/claude-sonnet-4-5",
          run: async ({ modelRound }) => {
            modelRound({})?.end();
            return "done";
          },
        }),
      ]),
    );
    http.end();

    await flushArizeTracing();
    const call = exporter.spans.find((s) => s.name.endsWith(" api/root-heritage"));
    const agent = exporter.spans.find((s) => s.name === "agent api/root-ask");
    const round = exporter.spans.find(
      (s) => s.name === "chat anthropic/claude-sonnet-4-5 api/root-ask",
    );
    expect(call).toBeDefined();
    expect(agent).toBeDefined();
    expect(call?.parentSpanContext).toBeUndefined();
    expect(agent?.parentSpanContext).toBeUndefined();
    expect(round?.parentSpanContext?.spanId).toBe(agent?.spanContext().spanId);
    expect(exporter.spans.some((s) => s.name === "POST /api/heritage")).toBe(false);
  });

  it("masks emails and handles in spans this module never built itself", async () => {
    // A span shaped like a framework span this module does not wrap: masking
    // must still happen at the exporter, the one choke point every span
    // passes on its way out.
    // The aggregate manager renames root GenAI spans to the tracer name
    // ("some-framework") and folds gen_ai.prompt into input.value; masking
    // must survive both.
    const span = trace.getTracer("some-framework").startSpan("framework.chat", {
      attributes: {
        "openinference.span.kind": "LLM",
        "gen_ai.prompt": "user wrote to bob@example.com as @karan",
      },
    });
    span.end();

    await flushArizeTracing();
    const masked = exporter.spans.find((s) => s.name === "some-framework");
    expect(masked).toBeDefined();
    expect(String(masked?.attributes["input.value"])).not.toContain(
      "bob@example.com",
    );
    expect(String(masked?.attributes["input.value"])).toContain("[email]");
    expect(String(masked?.attributes["gen_ai.prompt"])).not.toContain(
      "bob@example.com",
    );
  });

  it("drops spans that carry no OpenInference kind", async () => {
    const before = exporter.spans.length;
    const plain = trace.getTracer("http").startSpan("POST /api/anything");
    plain.end();

    await flushArizeTracing();
    expect(exporter.spans.length).toBe(before);
  });

  it("records no input on a social-post moderation span", async () => {
    const adapter = new OpenAISocialPostModerationAdapter({
      apiKey: "test-openai-key",
      fetcher: async () =>
        new Response(JSON.stringify({ results: [{ flagged: false }] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    });

    await expect(
      adapter.moderate({
        postId: "post-1",
        text: "held post text from Sam at 07700 900123",
        imageUrl: "https://example.supabase.co/signed/photo.jpg?token=abc",
      }),
    ).resolves.toEqual({ decision: "approved" });

    await flushArizeTracing();
    const span = exporter.spans.find(
      (s) => s.attributes["metadata.route"] === "moderation/social-post",
    );
    expect(span).toBeDefined();
    expect(span!.attributes["input.value"]).toBeUndefined();
    expect(JSON.stringify(span!.attributes)).not.toContain("07700 900123");
    expect(JSON.stringify(span!.attributes)).not.toContain("signed/photo.jpg");
    expect(span!.status.code).toBe(STATUS_OK);
  });

  it("ends an ask round OK and marks only the tool span when a tool throws", async () => {
    vi.mocked(runAskTool).mockRejectedValueOnce(new Error("tool exploded"));
    const fetchImpl = (async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                role: "assistant",
                content: null,
                tool_calls: [
                  {
                    id: "call-1",
                    type: "function",
                    function: { name: "search_venues", arguments: "{}" },
                  },
                ],
              },
            },
          ],
          usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )) as typeof fetch;

    const outcome = await runAskModelLoop({
      query: "cheap pints in Soho",
      ctx: { cityId: "london", query: "cheap pints in Soho" },
      apiKey: "test-openrouter-key",
      model: "test/tool-failure-model",
      fetchImpl,
      traceRoute: "test/ask-tool-failure",
    });

    expect(outcome).toBeNull();
    await flushArizeTracing();
    const routeSpans = exporter.spans.filter(
      (s) => s.attributes["metadata.route"] === "test/ask-tool-failure",
    );
    const round = routeSpans.find(
      (s) => s.attributes["openinference.span.kind"] === "LLM",
    );
    const tool = routeSpans.find(
      (s) => s.attributes["openinference.span.kind"] === "TOOL",
    );
    expect(round).toBeDefined();
    expect(tool).toBeDefined();
    expect(round!.status.code).toBe(STATUS_OK);
    expect(round!.endTime[0] * 1e9 + round!.endTime[1]).toBeLessThanOrEqual(
      tool!.startTime[0] * 1e9 + tool!.startTime[1],
    );
    expect(tool!.status.code).toBe(STATUS_ERROR);
    expect(tool!.events.some((event) => event.name === "exception")).toBe(true);
  });
});
