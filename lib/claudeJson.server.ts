import "server-only";

// THE JSON LANE. One Claude request in, one JSON answer out, and nothing
// written anywhere. The board reader (lib/boardRead.server.ts), the bill check
// (lib/billCheck.server.ts), the pub list import (lib/pubListImport.server.ts)
// and the avatar check (lib/profileAvatarModeration.ts) share it. A second
// client would be a second set of schema, timeout and tracing settings to keep
// in step, so there is none.
//
// Every read is a non-streaming Claude call on the shared key and model
// (lib/claudeClient.server.ts) with a strict JSON schema, low effort, a
// timeout and a token cap, and an Arize span through `traceArizeModelCall`
// with the caller's static route tag. Each caller spends its own paid lane
// (lib/paidSpendBudget.ts) before it calls this.
//
// FAIL CLOSED. No key answers `keyless` before anything is sent. A provider
// error, a refusal, a cut-off answer or an answer that is not JSON answers
// `failed`. The caller's own parser decides what in the answer it can trust.
//
// The input and the model's text never enter logs or tracing: the span records
// the model, the token counts and a fixed error, nothing else.

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";

import {
  claudeApiKey,
  claudeConfigured,
  claudeJsonClient,
  claudeModel,
  claudePromptTokens,
} from "@/lib/claudeClient.server";
import { traceArizeModelCall } from "@/lib/observability/arize";

// A JSON read only copies what it is shown. Low effort keeps it quick and cheap.
const EFFORT = "low" as const;

export type ClaudeJsonDependencies = {
  /** Answers the Claude API wire in tests; the platform fetch otherwise. */
  fetcher?: typeof fetch;
  env?: Record<string, string | undefined>;
};

export type ClaudeJsonOutcome =
  | { status: "keyless" }
  | { status: "failed"; retryable: boolean }
  | { status: "read"; answer: unknown };

export type ClaudeJsonRequest = {
  /** Static Arize route tag, such as "api/board-reads". */
  route: string;
  /** What the model is told. The user content is always data, never instructions. */
  system: string;
  /** The text or image the model reads. */
  content: Anthropic.ContentBlockParam[];
  /** Basic types only. The caller's parser enforces closed sets and limits. */
  schema: z.ZodType;
  /** Thinking counts toward this cap, so it leaves room above the answer. */
  maxTokens: number;
  timeoutMs: number;
  /** The fixed error the span records on any failure. Never the model's text. */
  failure: string;
};

/** Whether this deployment can make a JSON read at all. */
export function claudeJsonKeyed(env: Record<string, string | undefined> = process.env): boolean {
  return claudeConfigured(env);
}

/**
 * A prepared JPEG as Claude reads it. Pass the shared image journey's output
 * (metadata stripped, resized), never the bytes as uploaded.
 */
export function jpegImage(jpeg: Buffer): Anthropic.ImageBlockParam {
  return { type: "image", source: { type: "base64", media_type: "image/jpeg", data: jpeg.toString("base64") } };
}

/** A failure worth trying again: a timeout, a lost connection, a rate limit or a server error. */
function retryable(error: unknown): boolean {
  if (error instanceof Anthropic.APIUserAbortError || error instanceof Anthropic.APIConnectionError) return true;
  // A deadline that fires while the body is still arriving surfaces as the platform's own abort.
  if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) return true;
  if (error instanceof Anthropic.APIError) {
    const status = error.status ?? 0;
    return status === 408 || status === 429 || status >= 500;
  }
  return false;
}

/** Ask Claude for one JSON answer and return it unparsed by any caller rule. */
export async function readClaudeJson(
  request: ClaudeJsonRequest,
  deps: ClaudeJsonDependencies = {},
): Promise<ClaudeJsonOutcome> {
  const env = deps.env ?? process.env;
  const key = claudeApiKey(env);
  if (!key) return { status: "keyless" };
  const client = claudeJsonClient(key, deps.fetcher);
  const model = claudeModel(env);
  const { schema } = zodOutputFormat(request.schema);

  return traceArizeModelCall({
    route: request.route,
    model,
    provider: "anthropic",
    invocationParameters: { max_tokens: request.maxTokens, effort: EFFORT },
    call: async (span): Promise<ClaudeJsonOutcome> => {
      try {
        const message = await client.create(
          {
            model,
            max_tokens: request.maxTokens,
            system: request.system,
            output_config: { effort: EFFORT, format: { type: "json_schema", schema } },
            messages: [{ role: "user", content: request.content }],
          },
          { signal: AbortSignal.timeout(request.timeoutMs) },
        );
        const promptTokens = claudePromptTokens(message.usage);
        span.setUsage({
          promptTokens,
          completionTokens: message.usage.output_tokens,
          totalTokens: promptTokens + message.usage.output_tokens,
        });
        // A refusal or a cut-off answer is not a whole JSON answer.
        if (message.stop_reason !== "end_turn") {
          span.setError(new Error(request.failure));
          return { status: "failed", retryable: false };
        }
        const text = message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");
        return { status: "read", answer: JSON.parse(text) };
      } catch (error) {
        // Provider and parser errors can carry the model's text. A fixed error only.
        span.setError(new Error(request.failure));
        return { status: "failed", retryable: retryable(error) };
      }
    },
  });
}
