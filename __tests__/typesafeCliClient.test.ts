import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@typesafe-ai/sdk", () => ({
  TypeSafeClient: vi.fn(),
}));

import { TypeSafeClient } from "@typesafe-ai/sdk";

import { systemOne } from "@/lib/ai/typesafe";

describe("plain-node TypeSafe client", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.mocked(TypeSafeClient).mockReset();
    vi.restoreAllMocks();
  });

  it("honours the staging endpoint and keeps CLI diagnostics off stdout", async () => {
    vi.stubEnv("TYPESAFE_API_KEY", "test-key");
    vi.stubEnv("TYPESAFE_BASE_URL", "https://typesafe.staging.example");
    const calls: Array<{ config: unknown; options: unknown }> = [];
    vi.mocked(TypeSafeClient).mockImplementation(function (config: unknown) {
      return {
        systemOne: (_payload: unknown, options: unknown) => {
          calls.push({ config, options });
          return Promise.resolve({
            model: "jev-staging",
            usage: { input_tokens: 4, output_tokens: 1 },
            answers: { same_finding: { type: "noul", noul: 0.92 } },
          });
        },
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    const stdout = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    const result = await systemOne(
      { findingA: { evidence: "private review evidence" } },
      { same_finding: { type: "noul", instructions: "same defect?" } },
      {
        lane: "review-finding-dedup",
        timeoutMs: 5_000,
        logDestination: "stderr",
      },
    );

    expect(result?.answers.same_finding.noul).toBe(0.92);
    expect(calls).toHaveLength(1);
    expect(calls[0].config).toMatchObject({
      baseURL: "https://typesafe.staging.example",
      retry: { maxRetries: 0 },
    });
    expect(calls[0].options).toMatchObject({ timeout: 5_000 });
    expect((calls[0].options as { signal?: unknown }).signal).toBeInstanceOf(AbortSignal);
    expect(stdout).not.toHaveBeenCalled();
    expect(stderr).toHaveBeenCalledTimes(1);
    const line = String(stderr.mock.calls[0][0]);
    expect(line).toContain('"event":"typesafe.system_one"');
    expect(line).toContain('"lane":"review-finding-dedup"');
    expect(line).not.toContain("private review evidence");
    expect(line).not.toContain("test-key");
  });
});
