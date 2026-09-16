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

    expect(registerOTel).toHaveBeenCalledWith(
      expect.objectContaining({
        instrumentations: [expect.anything()],
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

  it("hands the model call an undefined span and still returns its result", async () => {
    delete process.env.ARIZE_API_KEY;
    delete process.env.ARIZE_SPACE_KEY;

    const seen: (unknown | undefined)[] = [];
    const result = await traceArizeModelCall({
      route: "api/heritage",
      model: "anthropic/claude-sonnet-4-5",
      call: async (span) => {
        seen.push(span);
        span?.setUsage({ promptTokens: 3 });
        span?.setOutput("never sent");
        return "answer";
      },
    });
    expect(result).toBe("answer");
    expect(seen).toEqual([undefined]);
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

  it("runs the model loop with undefined spans when inert", async () => {
    delete process.env.ARIZE_API_KEY;
    delete process.env.ARIZE_SPACE_KEY;

    const result = await traceArizeModelLoop({
      route: "api/ask",
      model: "anthropic/claude-sonnet-4-5",
      run: async ({ modelRound, toolCall }) => {
        const round = modelRound({ prompt: "anything" });
        const tool = toolCall({ name: "propose_map_action", input: { area: "Camden" } });
        round?.setUsage({ promptTokens: 1 });
        round?.setOutput("no-op");
        round?.end();
        tool?.setOutput("no-op");
        tool?.end();
        return { rounds: [round, tool] };
      },
    });
    expect(result).toEqual({ rounds: [undefined, undefined] });
  });
});
