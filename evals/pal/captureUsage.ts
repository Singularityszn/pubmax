import { isAskToolName } from "@/lib/ask/types";

import { offlineFetch, requestUrl } from "./offlineFetch";
import type { PalEvalUsage } from "./types";

export type ModelUsage = Omit<PalEvalUsage, "latencyMs">;

export type UsageCapture = {
  fetchImpl: typeof fetch;
  take(): ModelUsage;
};

function emptyUsage(): ModelUsage {
  return {
    modelCalls: 0,
    modelToolCalls: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    costUsd: 0,
  };
}

export function createUsageCapture(): UsageCapture {
  let usage = emptyUsage();
  let unpricedCalls = 0;

  const fetchImpl: typeof fetch = async (input, init) => {
    if (!new URL(requestUrl(input)).hostname.endsWith("openrouter.ai")) {
      return offlineFetch(input, init);
    }
    const response = await fetch(input, init);
    if (!response.ok) return response;
    const body = (await response.clone().json()) as {
      choices?: Array<{ message?: { tool_calls?: Array<{ function?: { name?: string } }> } }>;
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
        cost?: number;
      };
    };
    const cost = body.usage?.cost;
    usage.modelCalls += 1;
    usage.modelToolCalls += (body.choices?.[0]?.message?.tool_calls ?? []).filter((call) =>
      isAskToolName(call.function?.name ?? ""),
    ).length;
    if (typeof cost !== "number" || !Number.isFinite(cost)) {
      unpricedCalls += 1;
      return response;
    }
    usage.promptTokens += body.usage?.prompt_tokens ?? 0;
    usage.completionTokens += body.usage?.completion_tokens ?? 0;
    usage.totalTokens += body.usage?.total_tokens ?? 0;
    usage.costUsd += cost;
    return response;
  };

  return {
    fetchImpl,
    take() {
      if (unpricedCalls > 0) {
        throw new Error(
          `OpenRouter reported no usage.cost on ${unpricedCalls} call(s); the Pal eval cannot price this conversation.`,
        );
      }
      const taken = usage;
      usage = emptyUsage();
      return taken;
    },
  };
}
