import { publicApiError } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import { runAsk } from "@/lib/ask/runAsk";
import type { AskTurn } from "@/lib/ask/types";
import { PAL_ERROR_FALLBACK } from "@/lib/palChat";
import { runPalElevenLabsChatTurn } from "@/lib/palElevenLabsChat.server";
import { palVoiceConfigured } from "@/lib/pubPalVoiceConfig.server";
import { isLimited } from "@/lib/pintDrops";
import { clientIp, hashIp } from "@/lib/supabase";

export const maxDuration = 30;

const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 60_000;
const MAX_QUERY_LENGTH = 500;

function normaliseTurns(raw: unknown): AskTurn[] {
  if (!Array.isArray(raw)) return [];
  const turns: AskTurn[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    const role = record.role === "assistant" ? "assistant" : record.role === "user" ? "user" : null;
    const content = typeof record.content === "string" ? record.content.trim() : "";
    if (!role || !content) continue;
    turns.push({ role, content: content.slice(0, 800) });
    if (turns.length >= 6) break;
  }
  return turns;
}

export async function POST(request: Request): Promise<Response> {
  const limiterKey = `pub-pal-chat:${hashIp(clientIp(request))}`;
  if (
    await isLimited(limiterKey, limiterKey, RATE_LIMIT, RATE_WINDOW_MS, {
      failClosed: true,
    })
  ) {
    return publicApiError("Too many asks, slow down.", "RATE_LIMITED", 429, { retryable: true });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return publicApiError("Malformed JSON.", "MALFORMED_REQUEST", 400);
  }

  const record =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};

  const query =
    typeof record.query === "string" ? record.query.trim().slice(0, MAX_QUERY_LENGTH) : "";
  if (!query) {
    return publicApiError("Ask a question.", "QUERY_REQUIRED", 400);
  }

  // Voice is optional. Keyless deploys still answer from the same grounded
  // tools as /api/ask, and they never call OpenRouter.
  if (!palVoiceConfigured()) {
    try {
      const answer = await runAsk({
        query,
        cityId: record.cityId,
        turns: normaliseTurns(record.turns),
        skipModel: true,
        traceRoute: "api/pub-pal/chat",
      });
      return jsonNoStore(answer);
    } catch (error) {
      console.error("pub-pal-chat.unexpected_error", error);
      return publicApiError(PAL_ERROR_FALLBACK, "UNAVAILABLE", 503, { retryable: true });
    }
  }

  const outcome = await runPalElevenLabsChatTurn({
    query,
    cityId: record.cityId,
    turns: normaliseTurns(record.turns),
  });

  if (!outcome.ok) {
    return publicApiError(PAL_ERROR_FALLBACK, "UNAVAILABLE", 503, { retryable: true });
  }

  return jsonNoStore({
    answer: outcome.message,
    cards: outcome.cards,
    proposals: outcome.proposals,
    sources: [],
    status: "ready",
    toolsUsed: outcome.toolsUsed,
    conversationId: outcome.conversationId,
  });
}
