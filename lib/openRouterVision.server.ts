import "server-only";

// THE VISION LANE. One photo in, one JSON answer out, and nothing written
// anywhere. The board reader (lib/boardRead.server.ts, review item A4) and
// the bill check (lib/billCheck.server.ts, captain 5 Nov 2026) share this client.
// A second client would be a second set of retention and schema settings to
// keep in step, so there is none.
//
// THE SAME LANE AS THE OTHER OPENROUTER READERS: a direct chat completions call
// with `OPENROUTER_API_KEY`, the model from `OPENROUTER_MODEL` or the named
// default, zero data retention required of the provider, a strict JSON schema,
// a timeout and a token cap, and an Arize span through `traceArizeModelCall`
// with the caller's static route tag. Each caller spends its own paid lane
// (lib/paidSpendBudget.ts) before it calls this.
//
// FAIL CLOSED. No key answers `keyless` before anything is sent; a provider
// error or an answer that is not JSON answers `failed`. The caller's own parser
// decides what in the answer it can trust.
//
// The photo and the model's text never enter logs or tracing: the span records
// the model, the token counts and a fixed error, nothing else.

import { z } from "zod";

import { traceArizeModelCall } from "@/lib/observability/arize";
import { discardBody } from "@/lib/responseBody";

const OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_VISION_MODEL = "anthropic/claude-sonnet-4-5";

export type VisionReadDependencies = {
  fetcher?: typeof fetch;
  env?: Record<string, string | undefined>;
};

export type VisionReadOutcome =
  | { status: "keyless" }
  | { status: "failed" }
  | { status: "read"; answer: unknown };

export type VisionReadRequest = {
  /** A prepared JPEG (metadata stripped, resized), never the bytes as uploaded. */
  jpeg: Buffer;
  /** Static Arize route tag, such as "api/board-reads". */
  route: string;
  /** What the model is told. The photo is always data, never instructions. */
  prompt: string;
  /** The strict schema's name, sent to the provider. */
  schemaName: string;
  /** Basic types only: provider schemas do not take enums on every model. */
  schema: z.ZodType;
  maxTokens: number;
  timeoutMs: number;
  /** The fixed error the span records on any failure. Never the model's text. */
  failure: string;
};

/** Whether this deployment can read a photo at all. */
export function openRouterVisionKeyed(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(env.OPENROUTER_API_KEY?.trim());
}

const envelopeSchema = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string() }) })).min(1),
  usage: z.object({
    prompt_tokens: z.number().nonnegative().optional(),
    completion_tokens: z.number().nonnegative().optional(),
    total_tokens: z.number().nonnegative().optional(),
  }).optional(),
});

/** Show one prepared photo to the vision model and return its JSON answer. */
export async function readPhotoAsJson(
  request: VisionReadRequest,
  deps: VisionReadDependencies = {},
): Promise<VisionReadOutcome> {
  const env = deps.env ?? process.env;
  const key = env.OPENROUTER_API_KEY?.trim();
  if (!key) return { status: "keyless" };
  const fetcher = deps.fetcher ?? fetch;
  const model = env.OPENROUTER_MODEL?.trim() || DEFAULT_VISION_MODEL;
  const imageUrl = `data:image/jpeg;base64,${request.jpeg.toString("base64")}`;

  return traceArizeModelCall({
    route: request.route,
    model,
    provider: "openrouter",
    invocationParameters: { temperature: 0, max_tokens: request.maxTokens },
    call: async (span) => {
      try {
        const response = await fetcher(OPENROUTER_CHAT_URL, {
          method: "POST",
          headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model,
            temperature: 0,
            max_tokens: request.maxTokens,
            provider: { require_parameters: true, zdr: true },
            response_format: {
              type: "json_schema",
              json_schema: {
                name: request.schemaName,
                strict: true,
                schema: z.toJSONSchema(request.schema),
              },
            },
            messages: [
              {
                role: "user",
                content: [
                  { type: "text", text: request.prompt },
                  { type: "image_url", image_url: { url: imageUrl } },
                ],
              },
            ],
          }),
          signal: AbortSignal.timeout(request.timeoutMs),
          cache: "no-store",
        });
        if (!response.ok) {
          discardBody(response);
          span.setError(new Error(request.failure));
          return { status: "failed" };
        }
        const envelope = envelopeSchema.parse(await response.json());
        span.setUsage({
          promptTokens: envelope.usage?.prompt_tokens,
          completionTokens: envelope.usage?.completion_tokens,
          totalTokens: envelope.usage?.total_tokens,
        });
        return { status: "read", answer: JSON.parse(envelope.choices[0]!.message.content) };
      } catch {
        // Provider and parser errors can carry the model's text. A fixed error only.
        span.setError(new Error(request.failure));
        return { status: "failed" };
      }
    },
  });
}
