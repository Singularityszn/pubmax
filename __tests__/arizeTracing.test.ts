import { describe, expect, it, vi } from "vitest";

const { OpenAIInstrumentation } = vi.hoisted(() => ({
  OpenAIInstrumentation: vi.fn(function OpenAIInstrumentation() {}),
}));

// The registration seam is mocked so the INERT half of the contract can be
// asserted without any provider ever starting in this process: no
// registerOTel, no registerTelemetry, no exporter.
vi.mock("@vercel/otel", () => ({ registerOTel: vi.fn() }));
vi.mock("ai", () => ({ registerTelemetry: vi.fn() }));
vi.mock("@arizeai/openinference-instrumentation-openai", () => ({
  OpenAIInstrumentation,
}));

import {
  arizeProjectName,
  arizeTracingEnabled,
  maskPersonalData,
  registerArizeTracing,
  traceArizeModelCall,
  traceArizeModelLoop,
} from "@/lib/observability/arize";
import { registerTelemetry } from "ai";
import { registerOTel } from "@vercel/otel";

const cleanEnv = (): Record<string, string | undefined> => ({
  ARIZE_API_KEY: undefined,
  ARIZE_SPACE_KEY: undefined,
  ARIZE_PROJECT_NAME: undefined,
});

describe("Arize tracing activation", () => {
  it("stays off unless both keys are present", () => {
    expect(arizeTracingEnabled(cleanEnv())).toBe(false);
    expect(
      arizeTracingEnabled({ ...cleanEnv(), ARIZE_API_KEY: "key" }),
    ).toBe(false);
    expect(
      arizeTracingEnabled({ ...cleanEnv(), ARIZE_SPACE_KEY: "space" }),
    ).toBe(false);
    expect(
      arizeTracingEnabled({ ...cleanEnv(), ARIZE_API_KEY: "  ", ARIZE_SPACE_KEY: "space" }),
    ).toBe(false);
    expect(
      arizeTracingEnabled({
        ...cleanEnv(),
        ARIZE_API_KEY: "key",
        ARIZE_SPACE_KEY: "space",
      }),
    ).toBe(true);
  });

  it("registers the OpenAI SDK instrumentation when both keys are present", async () => {
    await registerArizeTracing({
      env: {
        ...cleanEnv(),
        ARIZE_API_KEY: "key",
        ARIZE_SPACE_KEY: "space",
      },
    });

    // expect.any, not expect.anything: the list must hold the OpenAI
    // instrumentation itself, not merely one entry of some kind.
    expect(registerOTel).toHaveBeenCalledWith(
      expect.objectContaining({
        instrumentations: [expect.any(OpenAIInstrumentation)],
      }),
    );
    expect(OpenAIInstrumentation).toHaveBeenCalledTimes(1);
  });

  it("routes to the captain's project name by default", () => {
    expect(arizeProjectName(cleanEnv())).toBe("Pubmaxx");
    expect(
      arizeProjectName({ ...cleanEnv(), ARIZE_PROJECT_NAME: " Other " }),
    ).toBe("Other");
  });
});

describe("Arize personal-data masking", () => {
  it("masks emails and handles", () => {
    expect(maskPersonalData("mail bob@example.com now")).toBe("mail [email] now");
    expect(maskPersonalData("meet @karan at the pub")).toBe("meet @[handle] at the pub");
    expect(maskPersonalData("a@b.co and c.d@e-f.gh.uk")).toBe("[email] and [email]");
    expect(maskPersonalData("@Handle_123 wins")).toBe("@[handle] wins");
  });

  it("leaves model names, URLs and prices untouched", () => {
    expect(maskPersonalData("anthropic/claude-sonnet-4-5")).toBe(
      "anthropic/claude-sonnet-4-5",
    );
    expect(maskPersonalData("https://openrouter.ai/api/v1/chat/completions")).toBe(
      "https://openrouter.ai/api/v1/chat/completions",
    );
    expect(maskPersonalData("pint 4.50 in Camden")).toBe("pint 4.50 in Camden");
  });

  it("is idempotent", () => {
    const once = maskPersonalData("bob@example.com said @karan");
    expect(maskPersonalData(once)).toBe(once);
  });
});

describe("Arize tracing is inert without the keys", () => {
  it("registers nothing", async () => {
    delete process.env.ARIZE_API_KEY;
    delete process.env.ARIZE_SPACE_KEY;
    delete process.env.ARIZE_PROJECT_NAME;

    await registerArizeTracing();
    expect(registerOTel).not.toHaveBeenCalled();
    expect(registerTelemetry).not.toHaveBeenCalled();
  });

  it("registers nothing on a non-Node runtime even with keys", async () => {
    await registerArizeTracing({
      env: {
        ARIZE_API_KEY: "key",
        ARIZE_SPACE_KEY: "space",
        NEXT_RUNTIME: "edge",
      },
    });
    expect(registerOTel).not.toHaveBeenCalled();
    expect(registerTelemetry).not.toHaveBeenCalled();
  });

  it("hands the model call a usage-only handle and still returns its result", async () => {
    delete process.env.ARIZE_API_KEY;
    delete process.env.ARIZE_SPACE_KEY;

    const result = await traceArizeModelCall({
      route: "api/heritage",
      model: "anthropic/claude-sonnet-4-5",
      call: async (span) => {
        span.setUsage({ promptTokens: 3 });
        span.setOutput("never sent");
        return "answer";
      },
    });
    expect(result).toBe("answer");
  });

  it("reports $ai_generation token counts to PostHog with Arize off", async () => {
    delete process.env.ARIZE_API_KEY;
    delete process.env.ARIZE_SPACE_KEY;
    process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN = "phc_test";
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    try {
      await traceArizeModelCall({
        route: "api/heritage",
        model: "anthropic/claude-sonnet-4-5",
        call: async (span) => {
          span.setUsage({ promptTokens: 3, completionTokens: 4, totalTokens: 7 });
          return "answer";
        },
      });
      await traceArizeModelLoop({
        route: "api/ask",
        model: "anthropic/claude-sonnet-4-5",
        run: async ({ modelRound }) => {
          const round = modelRound({ prompt: "anything" });
          round.setUsage({ promptTokens: 11, completionTokens: 5 });
          round.end();
          round.end();
          return null;
        },
      });
      const generations = fetchMock.mock.calls
        .map(([, init]) => JSON.parse(String((init as RequestInit).body)))
        .filter((body) => body.event === "$ai_generation")
        .map((body) => ({
          route: body.properties.route,
          input: body.properties.$ai_input_tokens,
          output: body.properties.$ai_output_tokens,
        }));
      expect(generations).toEqual([
        { route: "api/heritage", input: 3, output: 4 },
        { route: "api/ask", input: 11, output: 5 },
      ]);
    } finally {
      delete process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;
      vi.unstubAllGlobals();
    }
  });

  it("keeps errors flowing when inert", async () => {
    delete process.env.ARIZE_API_KEY;
    delete process.env.ARIZE_SPACE_KEY;

    await expect(
      traceArizeModelCall({
        route: "api/heritage",
        model: "anthropic/claude-sonnet-4-5",
        call: async () => {
          throw new Error("provider down");
        },
      }),
    ).rejects.toThrow("provider down");
  });

  it("runs the model loop with no tool spans when inert", async () => {
    delete process.env.ARIZE_API_KEY;
    delete process.env.ARIZE_SPACE_KEY;

    const result = await traceArizeModelLoop({
      route: "api/ask",
      model: "anthropic/claude-sonnet-4-5",
      run: async ({ modelRound, toolCall }) => {
        const round = modelRound({ prompt: "anything" });
        const tool = toolCall({ name: "propose_map_action", input: { area: "Camden" } });
        round.setUsage({ promptTokens: 1 });
        round.setOutput("no-op");
        round.end();
        tool?.setOutput("no-op");
        tool?.end();
        return { tool };
      },
    });
    expect(result).toEqual({ tool: undefined });
  });
});
