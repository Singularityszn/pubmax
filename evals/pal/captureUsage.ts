import type Anthropic from "@anthropic-ai/sdk";

import { isAskToolName } from "@/lib/ask/types";
import { claudePromptTokens, type ClaudeClient } from "@/lib/claudeClient.server";

import type { PalEvalUsage } from "./types";

type ModelUsage = Omit<PalEvalUsage, "latencyMs">;

export type UsageCapture = {
  /** The shared Claude client, metered: every finished round is counted. */
  claude: ClaudeClient;
  take(): ModelUsage;
};

type Rates = { input: number; output: number };

// US dollars per million tokens on the Claude API (platform.claude.com pricing,
// prompts up to 100K tokens). The API reports tokens, not cost, so a model
// missing here cannot be priced and the run says so instead of scoring $0.
const RATES_PER_MILLION: Record<string, Rates> = {
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
};
// Prompt cache reads bill at a tenth of input, and five-minute cache writes at 1.25 times input.
const CACHE_READ_FACTOR = 0.1;
const CACHE_WRITE_FACTOR = 1.25;

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

function costUsd(usage: Anthropic.Usage, rates: Rates): number {
  const input =
    usage.input_tokens +
    (usage.cache_read_input_tokens ?? 0) * CACHE_READ_FACTOR +
    (usage.cache_creation_input_tokens ?? 0) * CACHE_WRITE_FACTOR;
  return (input * rates.input + usage.output_tokens * rates.output) / 1_000_000;
}

/** Meter `inner`, the Claude client the live run sends on, priced as `model`. */
export function createUsageCapture(inner: ClaudeClient, model: string): UsageCapture {
  const rates = RATES_PER_MILLION[model];
  let usage = emptyUsage();

  const record = (message: Anthropic.Message) => {
    const promptTokens = claudePromptTokens(message.usage);
    usage.modelCalls += 1;
    usage.modelToolCalls += message.content.filter(
      (block) => block.type === "tool_use" && isAskToolName(block.name),
    ).length;
    usage.promptTokens += promptTokens;
    usage.completionTokens += message.usage.output_tokens;
    usage.totalTokens += promptTokens + message.usage.output_tokens;
    if (rates) usage.costUsd += costUsd(message.usage, rates);
  };

  const claude: ClaudeClient = {
    stream(body, options) {
      const stream = inner.stream(body, options);
      return {
        on: (event, listener) => stream.on(event, listener),
        finalMessage: async () => {
          const message = await stream.finalMessage();
          record(message);
          return message;
        },
      };
    },
  };

  return {
    claude,
    take() {
      if (!rates && usage.modelCalls > 0) {
        throw new Error(`No Claude API rate is recorded for ${model}; the Pal eval cannot price this conversation.`);
      }
      const taken = usage;
      usage = emptyUsage();
      return taken;
    },
  };
}
