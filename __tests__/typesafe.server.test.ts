import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@typesafe-ai/sdk", () => ({
  TypeSafeClient: vi.fn(),
}));

vi.mock("@/lib/paidSpendBudget.server", () => ({
  paidSpendBudgetRefusal: vi.fn(async () => null),
}));

import { TypeSafeClient } from "@typesafe-ai/sdk";

import { systemOne, TYPESAFE_API_BASE_URL } from "@/lib/ai/typesafe.server";
import { defined } from "@/__tests__/helpers/defined";

describe("systemOne", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.mocked(TypeSafeClient).mockReset();
  });

  it("returns null without calling the SDK when the API key is unset", async () => {
    delete process.env.TYPESAFE_API_KEY;
    const result = await systemOne(
      { message: "hello" },
      { q: { type: "noul", instructions: "test?" } },
      { lane: "typesafe" },
    );
    expect(result).toBeNull();
    expect(TypeSafeClient).not.toHaveBeenCalled();
  });
});

describe("systemOne request bounds", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.mocked(TypeSafeClient).mockReset();
  });

  it("disables SDK retries and passes a wall-clock deadline", async () => {
    vi.stubEnv("TYPESAFE_API_KEY", "test-key");
    const calls: Array<{ config: unknown; options: unknown }> = [];
    vi.mocked(TypeSafeClient).mockImplementation(function (config: unknown) {
      return {
        systemOne: (_payload: unknown, options: unknown) => {
          calls.push({ config, options });
          return Promise.resolve({
            model: "jev-test",
            usage: { input_tokens: 1, output_tokens: 1 },
            answers: { q: { type: "noul", noul: 0.5 } },
          });
        },
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    await systemOne(
      { message: "hello" },
      { q: { type: "noul", instructions: "test?" } },
      { lane: "typesafe" },
    );

    expect(calls).toHaveLength(1);
    const config = defined(calls[0]).config as { retry?: { maxRetries?: number }; baseURL?: string };
    // The SDK default is two retries with no total budget and a Retry-After it
    // will honour for a minute. Both would take this call off the 4s bound the
    // Pub Pal request path is held to, and bill three times per counted spend.
    expect(config.retry?.maxRetries).toBe(0);
    expect(config.baseURL).toBe(TYPESAFE_API_BASE_URL);

    const options = defined(calls[0]).options as { timeout?: number; signal?: AbortSignal };
    expect(options.timeout).toBe(4_000);
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  it("gives up on the deadline and answers null rather than hanging the caller", async () => {
    vi.stubEnv("TYPESAFE_API_KEY", "test-key");
    vi.mocked(TypeSafeClient).mockImplementation(function () {
      return {
        // A hung endpoint: this only ever settles because the caller's own
        // deadline aborts it. Without that signal it never settles, which is
        // exactly the failure this test exists to catch.
        systemOne: (_payload: unknown, options: { signal?: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            options.signal?.addEventListener("abort", () =>
              reject(new Error("aborted")),
            );
          }),
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    const started = Date.now();
    const result = await systemOne(
      { message: "hello" },
      { q: { type: "noul", instructions: "test?" } },
      { lane: "typesafe", timeoutMs: 40 },
    );
    expect(result).toBeNull();
    expect(Date.now() - started).toBeLessThan(2_000);
  });
});

describe("systemOne logging", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.mocked(TypeSafeClient).mockReset();
    vi.restoreAllMocks();
  });

  it("never writes a drinker's typed text into a log line", async () => {
    vi.stubEnv("TYPESAFE_API_KEY", "test-key");
    vi.mocked(TypeSafeClient).mockImplementation(function () {
      return {
        systemOne: () =>
          Promise.resolve({
            model: "jev-test",
            usage: { input_tokens: 1, output_tokens: 1 },
            answers: { q: { type: "noul", noul: 0.5 } },
          }),
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((line: unknown) => {
      lines.push(String(line));
    });

    const secret = "Am I too drunk to drive back to Peckham";
    await systemOne(
      { message: secret, recentTurns: [{ role: "user", content: "two pints in" }] },
      { q: { type: "noul", instructions: "test?" } },
      { lane: "typesafe" },
    );

    expect(lines.length).toBeGreaterThan(0);
    const emitted = lines.join("\n");
    expect(emitted).not.toContain("Peckham");
    expect(emitted).not.toContain("two pints in");
    // The size is what an operator reads instead.
    expect(emitted).toContain(`"messageChars":${secret.length}`);
    expect(emitted).toContain('"turnCount":1');
  });
});
