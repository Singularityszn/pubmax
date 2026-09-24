import type { PalEvalUsage } from "./types";

const DEFAULT_USD_PER_MTOK = {
  input: 3,
  output: 15,
};

export type UsageCapture = PalEvalUsage & {
  fetchImpl: typeof fetch;
};

export function createUsageCapture(modelHint?: string): UsageCapture {
  const state: UsageCapture = {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    latencyMs: 0,
    costUsd: 0,
    fetchImpl: fetch,
  };

  const rates = DEFAULT_USD_PER_MTOK;

  state.fetchImpl = async (input, init) => {
    const started = performance.now();
    const response = await fetch(input, init);
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    if (url.includes("openrouter.ai") && response.ok) {
      try {
        const clone = response.clone();
        const body = (await clone.json()) as {
          usage?: {
            prompt_tokens?: number;
            completion_tokens?: number;
            total_tokens?: number;
          };
        };
        const usage = body.usage;
        if (usage) {
          state.promptTokens += usage.prompt_tokens ?? 0;
          state.completionTokens += usage.completion_tokens ?? 0;
          state.totalTokens += usage.total_tokens ?? 0;
          state.costUsd +=
            ((usage.prompt_tokens ?? 0) * rates.input +
              (usage.completion_tokens ?? 0) * rates.output) /
            1_000_000;
        }
      } catch {
        /* ignore parse errors */
      }
    }
    state.latencyMs += performance.now() - started;
    return response;
  };

  void modelHint;
  return state;
}
