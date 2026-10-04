import { publicApiError } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import { isAskToolName } from "@/lib/ask/types";
import {
  PAL_RECALL_MEMORIES_TOOL,
  recallPalMemoriesForConversation,
} from "@/lib/palConfirmedMemories.server";
import {
  PAL_PROPOSE_MEMORY_TOOL,
  proposePalMemoryForConversation,
} from "@/lib/palMemoryProposal.server";
import { assertPubPalLlmAuth } from "@/lib/pubPalLlmAuth";
import {
  invokePubPalAskTool,
  parsePubPalToolWebhookBody,
} from "@/lib/pubPalToolInvoke.server";
import { isLimited } from "@/lib/pintDrops";
import {
  PUB_PAL_WEBHOOK_RATE_LIMIT,
  PUB_PAL_WEBHOOK_RATE_WINDOW_MS,
  pubPalWebhookLimiterKey,
} from "@/lib/pubPalWebhookRateLimit";

export const maxDuration = 30;

type RouteContext = { params: Promise<{ toolName: string }> };

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const authDenied = assertPubPalLlmAuth(request);
  if (authDenied) return authDenied;

  const { toolName } = await context.params;
  const normalized = toolName.trim();
  const palOnly = normalized === PAL_RECALL_MEMORIES_TOOL || normalized === PAL_PROPOSE_MEMORY_TOOL;
  if (!palOnly && !isAskToolName(normalized)) {
    return publicApiError("That tool is not available.", "TOOL_NOT_ALLOWED", 404);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return publicApiError("Malformed JSON.", "MALFORMED_REQUEST", 400);
  }

  const { conversationId, args } = parsePubPalToolWebhookBody(body);
  const limiterKey = pubPalWebhookLimiterKey(normalized);
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
  if (normalized === PAL_RECALL_MEMORIES_TOOL) {
    return jsonNoStore(await recallPalMemoriesForConversation(conversationId));
  }
  if (normalized === PAL_PROPOSE_MEMORY_TOOL) {
    return jsonNoStore(await proposePalMemoryForConversation(conversationId, args));
  }
  const outcome = await invokePubPalAskTool({
    toolName: normalized,
    args,
    conversationId,
  });
  return jsonNoStore(outcome);
}
