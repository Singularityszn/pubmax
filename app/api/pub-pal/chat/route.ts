import { publicApiError } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import { callerUserId } from "@/lib/authServer";
import { refineRoutedAskQuery, socialTurnKind } from "@/lib/ask/router";
import { runAsk } from "@/lib/ask/runAsk";
import type { AskTurn } from "@/lib/ask/types";
import { parseConciergeIntent } from "@/lib/concierge/intent";
import { DEFAULT_GROUP_SIZE } from "@/lib/concierge/intentPolicy";
import { PAL_ERROR_FALLBACK } from "@/lib/palChat";
import {
  acceptsPalChatStream,
  encodePalChatStreamEvent,
  PAL_CHAT_STREAM_TYPE,
  type PalChatStreamEvent,
} from "@/lib/palChatStream";
import {
  runPalElevenLabsChatTurn,
  type PalElevenLabsChatInput,
  type PalElevenLabsChatOutcome,
} from "@/lib/palElevenLabsChat.server";
import { paidSpendBudgetRefusal } from "@/lib/paidSpendBudget.server";
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

function answerBody(outcome: Extract<PalElevenLabsChatOutcome, { ok: true }>) {
  return {
    answer: outcome.message,
    cards: outcome.cards,
    proposals: outcome.proposals,
    sources: [],
    status: "ready",
    toolsUsed: outcome.toolsUsed,
    conversationId: outcome.conversationId,
  };
}

/**
 * The same turn as the JSON path, sent as it is written. Everything that can
 * refuse the ask (rate limit, sign-in, spend ceiling) has already answered with
 * its normal JSON status before this runs, so a refusal never opens a stream.
 * Only a failure after the stream began is an `error` event.
 */
function streamTurn(input: PalElevenLabsChatInput, request: Request): Response {
  const encoder = new TextEncoder();
  const abort = new AbortController();
  request.signal.addEventListener("abort", () => abort.abort(), { once: true });
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: PalChatStreamEvent) => {
        try {
          controller.enqueue(encoder.encode(encodePalChatStreamEvent(event)));
        } catch {
          // The reader has gone away.
        }
      };
      try {
        const outcome = await runPalElevenLabsChatTurn({
          ...input,
          signal: abort.signal,
          onProgress: send,
        });
        send(
          outcome.ok
            ? { type: "final", body: answerBody(outcome) }
            : { type: "error", error: PAL_ERROR_FALLBACK },
        );
      } catch (error) {
        console.error("pub-pal-chat.stream_error", error);
        send({ type: "error", error: PAL_ERROR_FALLBACK });
      } finally {
        try {
          controller.close();
        } catch {
          // Already closed by the reader going away.
        }
      }
    },
    cancel() {
      abort.abort();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": `${PAL_CHAT_STREAM_TYPE}; charset=utf-8`,
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
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
      const turns = normaliseTurns(record.turns);
      const social = socialTurnKind(query);
      if (social) {
        return jsonNoStore({
          answer: social === "thanks"
            ? "You're welcome."
            : turns.some((turn) => turn.role === "assistant")
              ? "Hey."
              : "Hi. What kind of night are you planning?",
          cards: [],
          proposals: [],
          sources: [],
          status: "ready",
          toolsUsed: [],
        });
      }
      const answer = await runAsk({
        query,
        cityId: record.cityId,
        turns,
        skipModel: true,
        traceRoute: "api/pub-pal/chat",
      });
      // search_venues ranks on area, mood, budget and group size only. With
      // none of them it lists the same arbitrary pubs for any words ("hi how
      // are you", "sup"), so ask for one instead.
      if (answer.toolsUsed.length === 1 && answer.toolsUsed[0] === "search_venues") {
        const priorUser = [...turns].reverse().find((turn) => turn.role === "user");
        const { intent } = await parseConciergeIntent(
          refineRoutedAskQuery(query, priorUser?.content),
          { skipModel: true },
        );
        if (
          intent.mood.length === 0 &&
          !intent.area &&
          intent.maxPintPrice === undefined &&
          intent.groupSize === DEFAULT_GROUP_SIZE
        ) {
          return jsonNoStore({
            answer: "Tell me an area, a mood or a budget and I'll find you a pub.",
            cards: [],
            proposals: [],
            sources: [],
            status: "ready",
            toolsUsed: [],
          });
        }
      }
      return jsonNoStore(answer);
    } catch (error) {
      console.error("pub-pal-chat.unexpected_error", error);
      return publicApiError(PAL_ERROR_FALLBACK, "UNAVAILABLE", 503, { retryable: true });
    }
  }

  const ownerId = await callerUserId(request);
  if (!ownerId) {
    return publicApiError("Sign in to ask Pub Pal.", "UNAUTHENTICATED", 401);
  }

  const budgetRefusal = await paidSpendBudgetRefusal("pub-pal-chat");
  if (budgetRefusal) return budgetRefusal;

  const turn: PalElevenLabsChatInput = {
    query,
    cityId: record.cityId,
    threadId: record.threadId,
    fenceTurns: normaliseTurns(record.turns).filter((item) => item.role === "user"),
    ownerId,
  };
  if (acceptsPalChatStream(request.headers.get("accept"))) return streamTurn(turn, request);

  const outcome = await runPalElevenLabsChatTurn(turn);

  if (!outcome.ok) {
    return publicApiError(PAL_ERROR_FALLBACK, "UNAVAILABLE", 503, { retryable: true });
  }

  return jsonNoStore(answerBody(outcome));
}
