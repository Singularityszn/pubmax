import { publicApiError } from "@/lib/apiError";
import { runAsk } from "@/lib/ask/runAsk";
import { assertPubPalLlmAuth } from "@/lib/pubPalLlmAuth";
import {
  pubPalGetHomeRegisterAnswer,
  resolvePubPalFenceIntent,
} from "@/lib/pubPalLlmFence";
import {
  extractAskTurns,
  extractLastUserMessage,
  streamOpenAiChatCompletion,
  type OpenAiChatCompletionRequest,
} from "@/lib/pubPalLlmStream";
import { paidSpendBudgetRefusal } from "@/lib/paidSpendBudget.server";
import { isLimited } from "@/lib/pintDrops";
import {
  PUB_PAL_WEBHOOK_RATE_LIMIT,
  PUB_PAL_WEBHOOK_RATE_WINDOW_MS,
  pubPalWebhookLimiterKey,
} from "@/lib/pubPalWebhookRateLimit";

export async function POST(request: Request): Promise<Response> {
  const authDenied = assertPubPalLlmAuth(request);
  if (authDenied) return authDenied;

  // The per-address budget above is one signal and a caller picks their own
  // address. This ceiling is the deployment's, and no header widens it. It is
  // spent AFTER the shared-secret gate on purpose: this lane has a real caller
  // (the ElevenLabs bridge), so an unauthorised flood must not be able to eat
  // the budget that caller depends on.
  const budgetRefusal = await paidSpendBudgetRefusal("pub-pal-llm");
  if (budgetRefusal) return budgetRefusal;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return publicApiError("Malformed JSON.", "MALFORMED_REQUEST", 400);
  }

  const record =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as OpenAiChatCompletionRequest)
      : {};

  const query = extractLastUserMessage(record.messages);
  if (!query) {
    return publicApiError("Ask a question.", "QUERY_REQUIRED", 400);
  }

  const turns = extractAskTurns(record.messages);
  const limiterKey = pubPalWebhookLimiterKey("llm");
  if (
    await isLimited(
      limiterKey,
      limiterKey,
      PUB_PAL_WEBHOOK_RATE_LIMIT,
      PUB_PAL_WEBHOOK_RATE_WINDOW_MS,
      {
      failClosed: true,
      },
    )
  ) {
    return publicApiError("Too many requests, slow down.", "RATE_LIMITED", 429, {
      retryable: true,
    });
  }
  const { fenced, sobrietyOnly } = await resolvePubPalFenceIntent(query, turns);

  const answerBody = await runAsk({
    query,
    cityId: record.cityId,
    turns,
    skipModel: true,
    traceRoute: "api/pub-pal/llm",
  });

  const answer = fenced
    ? pubPalGetHomeRegisterAnswer(answerBody.answer, sobrietyOnly)
    : answerBody.answer;

  return streamOpenAiChatCompletion(answer, record.model ?? "pubmax-ask-grounded");
}
