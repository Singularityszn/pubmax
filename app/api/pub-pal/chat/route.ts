import { publicApiError } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import { callerUserId } from "@/lib/authServer";
import { runAsk } from "@/lib/ask/runAsk";
import type { AskTurn } from "@/lib/ask/types";
import { PAL_ERROR_FALLBACK } from "@/lib/palChat";
import {
  resolvePalElevenLabsChatPrelude,
  runPalElevenLabsChatTurn,
} from "@/lib/palElevenLabsChat.server";
import { PAL_CHAT_SERVER_TIMEOUT_MS } from "@/lib/palChatDeadline";
import { pubPalGetHomeRegisterAnswer } from "@/lib/pubPalLlmFence";
import { paidSpendBudgetRefusal } from "@/lib/paidSpendBudget.server";
import { palVoiceConfigured } from "@/lib/pubPalVoiceConfig.server";
import {
  isPubPalRouteProposalAsk,
  projectPubPalRouteProposals,
  pubPalRouteProposalsAllowed,
  pubPalRouteProposalsOffAnswer,
  PubPalRoutePreferencesUnavailableError,
} from "@/lib/pubPalRouteProposalPolicy.server";
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

  const voiceConfigured = palVoiceConfigured();
  const ownerId = await callerUserId(request);
  try {
    if (isPubPalRouteProposalAsk(query) && !await pubPalRouteProposalsAllowed(ownerId)) {
      if (voiceConfigured && ownerId) {
        const prelude = await resolvePalElevenLabsChatPrelude({
          query,
          threadId: record.threadId,
          fenceTurns: normaliseTurns(record.turns).filter((turn) => turn.role === "user"),
          ownerId,
        }, Date.now() + PAL_CHAT_SERVER_TIMEOUT_MS);
        if (!prelude.ok) {
          return publicApiError(PAL_ERROR_FALLBACK, "UNAVAILABLE", 503, { retryable: true });
        }
        if (prelude.fenceIntent.fenced) {
          return jsonNoStore({
            answer: pubPalGetHomeRegisterAnswer("", prelude.fenceIntent.sobrietyOnly),
            cards: [],
            proposals: [],
            sources: [],
            status: "ready",
            toolsUsed: [],
            conversationId: "",
          });
        }
      }
      return jsonNoStore(pubPalRouteProposalsOffAnswer());
    }
  } catch (error) {
    if (!(error instanceof PubPalRoutePreferencesUnavailableError)) throw error;
    return publicApiError(error.message, "UNAVAILABLE", 503, { retryable: true });
  }

  // Voice is optional. Keyless deploys still answer from the same grounded
  // tools as /api/ask, and they never call OpenRouter.
  if (!voiceConfigured) {
    try {
      const answer = await runAsk({
        query,
        cityId: record.cityId,
        turns: normaliseTurns(record.turns),
        skipModel: true,
        traceRoute: "api/pub-pal/chat",
      });
      return jsonNoStore(await projectPubPalRouteProposals(answer, ownerId));
    } catch (error) {
      console.error("pub-pal-chat.unexpected_error", error);
      return publicApiError(PAL_ERROR_FALLBACK, "UNAVAILABLE", 503, { retryable: true });
    }
  }

  if (!ownerId) {
    return publicApiError("Sign in to ask Pub Pal.", "UNAUTHENTICATED", 401);
  }

  const budgetRefusal = await paidSpendBudgetRefusal("pub-pal-chat");
  if (budgetRefusal) return budgetRefusal;

  const outcome = await runPalElevenLabsChatTurn({
    query,
    cityId: record.cityId,
    threadId: record.threadId,
    fenceTurns: normaliseTurns(record.turns).filter((turn) => turn.role === "user"),
    ownerId,
  });

  if (!outcome.ok) {
    return publicApiError(PAL_ERROR_FALLBACK, "UNAVAILABLE", 503, { retryable: true });
  }

  const answer = {
    answer: outcome.message,
    cards: outcome.cards,
    proposals: outcome.proposals,
    sources: [],
    status: "ready" as const,
    toolsUsed: outcome.toolsUsed,
    conversationId: outcome.conversationId,
  };
  try {
    return jsonNoStore(await projectPubPalRouteProposals(answer, ownerId));
  } catch (error) {
    if (!(error instanceof PubPalRoutePreferencesUnavailableError)) throw error;
    return publicApiError(error.message, "UNAVAILABLE", 503, { retryable: true });
  }
}
