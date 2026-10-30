import { PalChatDeadlineExceeded, assertPalChatDeadline, beforePalChatDeadline } from "@/lib/palChatDeadline";
import { openPalConversation } from "@/lib/palOpening.server";
import { palOpeningAcceptance, palOpeningFollowUp } from "@/lib/palOpening";
import { readOwnedPubPalToolTurn, registerPubPalToolTurn } from "@/lib/pubPalToolTurnStore";
import { isPubPalConversationId } from "@/lib/pubPalConversationId";
import { pubPalGetHomeRegisterAnswer, regexFenceIntent, resolvePubPalFenceIntent } from "@/lib/pubPalLlmFence";
import { publicApiError } from "@/lib/apiError";
import { askCardSources } from "@/lib/ask/types";
import { jsonNoStore } from "@/lib/apiResponses";
import { callerUserId } from "@/lib/authServer";
import { isVenueHoursQuestion, refineRoutedAskQuery, socialTurnKind } from "@/lib/ask/router";
import { runAsk } from "@/lib/ask/runAsk";
import type { AskTurn } from "@/lib/ask/types";
import { parseConciergeIntent } from "@/lib/concierge/intent";
import { DEFAULT_GROUP_SIZE, defaultKnownAreas } from "@/lib/concierge/intentPolicy";
import { PAL_ERROR_FALLBACK } from "@/lib/palChat";
import {
  acceptsPalChatStream,
  encodePalChatStreamEvent,
  PAL_CHAT_STREAM_TYPE,
  type PalChatStreamEvent,
} from "@/lib/palChatStream";
import {
  runPalElevenLabsChatTurn,
  palChatRecordQuery,
  preparePalElevenLabsChatTurn,
  type PalElevenLabsChatContext,
  type PalElevenLabsChatInput,
  type PalElevenLabsChatOutcome,
} from "@/lib/palElevenLabsChat.server";
import { palClaudeConfigured, runPalClaudeChatTurn } from "@/lib/palClaudeChat.server";
import { paidSpendBudgetRefusal } from "@/lib/paidSpendBudget.server";
import { palTasteAsk } from "@/lib/palTaste";
import { readPalTaste } from "@/lib/palTaste.server";
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

/**
 * Typed chat goes to Claude when this deploy has an Anthropic key, else to the
 * ElevenLabs agent. Voice stays on ElevenLabs either way.
 */
function typedChatConfigured(): boolean {
  return palClaudeConfigured() || palVoiceConfigured();
}

function runTypedTurn(input: PalElevenLabsChatInput, context: PalElevenLabsChatContext): Promise<PalElevenLabsChatOutcome> {
  return palClaudeConfigured() ? runPalClaudeChatTurn(input, context) : runPalElevenLabsChatTurn(input, context);
}

function answerBody(outcome: Extract<PalElevenLabsChatOutcome, { ok: true }>) {
  return {
    answer: outcome.message,
    cards: outcome.cards,
    proposals: outcome.proposals,
    sources: askCardSources(outcome.cards),
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
function streamTurn(input: PalElevenLabsChatInput, context: PalElevenLabsChatContext, request: Request): Response {
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
        const outcome = await runTypedTurn({
          ...input,
          signal: abort.signal,
          onProgress: send,
        }, context);
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

export async function GET(request: Request): Promise<Response> {
  const limiterKey = `pub-pal-chat:${hashIp(clientIp(request))}`;
  if (await isLimited(limiterKey, limiterKey, RATE_LIMIT, RATE_WINDOW_MS, { failClosed: true })) {
    return publicApiError("Too many asks, slow down.", "RATE_LIMITED", 429, { retryable: true });
  }
  const ownerId = await callerUserId(request);
  if (!ownerId) return publicApiError("Sign in to read your Pal opening.", "UNAUTHENTICATED", 401);
  try {
    return jsonNoStore(await openPalConversation(ownerId));
  } catch {
    return publicApiError("Your saved memories could not be read just now.", "UNAVAILABLE", 503, { retryable: true });
  }
}

function openingResponse(opening: { answer: string; conversationId: string }): Response {
  return jsonNoStore({ ...opening, cards: [], proposals: [], sources: [], toolsUsed: [], status: "ready" });
}

async function openingReply(
  request: Request, record: Record<string, unknown>, query: string,
  prepared?: { ownerId: string; context: PalElevenLabsChatContext },
  onWriteStarted?: (response: Response) => void,
): Promise<Response | null> {
  const social = socialTurnKind(query);
  const firstGreeting = social === "greeting" && !record.threadId && normaliseTurns(record.turns).length === 0;
  const threadId = typeof record.threadId === "string" && isPubPalConversationId(record.threadId) ? record.threadId : null;
  if (firstGreeting || threadId) {
    const ownerId = prepared?.ownerId ?? await callerUserId(request);
    if (ownerId) {
      try {
        if (firstGreeting) return jsonNoStore(await openPalConversation(
          ownerId, prepared?.context.deadline, (opening) => onWriteStarted?.(openingResponse(opening)),
        ));
        const prior = prepared
          ? prepared.context.prior.ownedTurn ?? null
          : threadId ? await readOwnedPubPalToolTurn(threadId, ownerId) : null;
        // The sole assistant turn and matching result hint are the pending opening.
        // Clearing its hint consumes it without adding this ask to earlier history.
        if (!threadId || !prior || prior.turns.length !== 1 || prior.turns[0]?.role !== "assistant"
          || prior.hints.length !== 1) return null;
        let answer: string | null = null;
        if (palOpeningAcceptance(query)) answer = palOpeningFollowUp(query, prior.turns[0].content);
        // A retry after an uncertain commit replays its answer without another write.
        if (prior.query) {
          return prepared && prior.query === query && answer && prior.hints[0] === answer
            ? openingResponse({ answer, conversationId: threadId }) : null;
        }
        if (prior.hints[0] !== prior.turns[0].content) return null;
        // The configured runner replaces the pending opening with the actual turn.
        // Do not consume it in a separate write before a substantive ask succeeds.
        if (prepared && !answer) return null;
        if (prepared) assertPalChatDeadline(prepared.context.deadline);
        await registerPubPalToolTurn(threadId, {
          deadline: prepared?.context.deadline,
          onWriteStarted: answer ? () => onWriteStarted?.(openingResponse({ answer, conversationId: threadId })) : undefined,
          ownerId, cityId: prior.cityId, query: answer ? query : "", turns: prior.turns,
          cards: [], proposals: [], hints: answer ? [answer] : [], toolsUsed: [],
        });
        if (answer) {
          return openingResponse({ answer, conversationId: threadId });
        }
      } catch {
        return publicApiError("Your saved conversation could not be read just now.", "UNAVAILABLE", 503, { retryable: true });
      }
    }
  }
  return null;
}

function keylessSocialReply(query: string, turns: AskTurn[]): Response | null {
  const social = socialTurnKind(query);
  if (!social) return null;
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

export async function POST(request: Request): Promise<Response> {
  const limiterKey = `pub-pal-chat:${hashIp(clientIp(request))}`;
  // The limiter answers before anything else is asked: the token check is a
  // GoTrue round trip, and a refused request must not reach the auth backend.
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

  const configured = typedChatConfigured();
  const ownerId = configured ? await callerUserId(request) : null;
  if (configured && !ownerId) {
    return publicApiError("Sign in to ask Pub Pal.", "UNAUTHENTICATED", 401);
  }
  const turns = normaliseTurns(record.turns);
  const turn: PalElevenLabsChatInput = {
    query,
    cityId: record.cityId,
    threadId: record.threadId,
    fenceTurns: turns.filter((item) => item.role === "user"),
    ownerId: ownerId!,
  };
  // Current and browser safety requests must still answer when stored history is unavailable.
  let fence = configured ? regexFenceIntent(query, turns) : await resolvePubPalFenceIntent(query, turns);
  let context: PalElevenLabsChatContext | undefined;
  if (configured && !fence.fenced) {
    try {
      context = await preparePalElevenLabsChatTurn(turn);
      fence = context.fence;
    } catch {
      return publicApiError(PAL_ERROR_FALLBACK, "UNAVAILABLE", 503, { retryable: true });
    }
  }
  if (fence.fenced) {
    return jsonNoStore({
      answer: pubPalGetHomeRegisterAnswer("", fence.sobrietyOnly),
      cards: [], proposals: [], sources: [], toolsUsed: [], status: "ready", conversationId: "",
    });
  }

  let committingOpening: Response | undefined;
  try {
    const readOpening = () => openingReply(request, record, query, context ? { context, ownerId: ownerId! } : undefined,
      (response) => { committingOpening = response; });
    const opening = context ? await beforePalChatDeadline(context.deadline, readOpening) : await readOpening();
    if (opening) return opening;
  } catch (error) {
    // Persistence can finish after the request budget. The owned opening is
    // already a useful answer, so an in-flight commit must not become a 503.
    if (error instanceof PalChatDeadlineExceeded && committingOpening) return committingOpening;
    return publicApiError(PAL_ERROR_FALLBACK, "UNAVAILABLE", 503, { retryable: true });
  }

  // A model is optional. Keyless deploys still answer from the same grounded
  // tools as /api/ask, and they never call OpenRouter, Anthropic or ElevenLabs.
  if (!configured) {
    try {
      const social = keylessSocialReply(query, turns);
      if (social) return social;
      const answer = await runAsk({
        query,
        cityId: record.cityId,
        turns,
        skipModel: true,
        traceRoute: "api/pub-pal/chat",
      });
      // Discovery ranks on area, mood, budget and group size. Without one,
      // it lists arbitrary pubs, so ask for a constraint. Preserve named-hours
      // results, including refusals and read failures, before this fallback.
      if (!isVenueHoursQuestion(query) && answer.toolsUsed.length === 1 && answer.toolsUsed[0] === "search_venues") {
        const priorUser = [...turns].reverse().find((turn) => turn.role === "user");
        const { intent } = await parseConciergeIntent(
          refineRoutedAskQuery(query, priorUser?.content, turns.filter((turn) => turn.role === "user").map((turn) => turn.content)),
          { skipModel: true },
        );
        if (
          intent.mood.length === 0 &&
          !intent.area &&
          intent.maxPintPrice === undefined &&
          intent.groupSize === DEFAULT_GROUP_SIZE
        ) {
          // A signed-in person who has logged their nights gets a pick off
          // their own patch and habits instead of a question.
          const ownerId = await callerUserId(request);
          const tasteAsk = ownerId
            ? palTasteAsk(await readPalTaste(ownerId), defaultKnownAreas())
            : null;
          if (tasteAsk) {
            const picked = await runAsk({
              query: tasteAsk.query,
              cityId: record.cityId,
              skipModel: true,
              traceRoute: "api/pub-pal/chat",
            });
            if (picked.cards.length > 0) {
              return jsonNoStore({ ...picked, answer: `${tasteAsk.because} ${picked.answer}` });
            }
          }
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

  try {
    return await configuredTurn(turn, context!, request);
  } catch {
    return publicApiError(PAL_ERROR_FALLBACK, "UNAVAILABLE", 503, { retryable: true });
  }
}

async function configuredTurn(turn: PalElevenLabsChatInput, context: PalElevenLabsChatContext, request: Request): Promise<Response> {
  // The spend ceiling applies only when a provider turn is needed. The
  // address limiter, owner check and safety fence still cover local records.
  if (palChatRecordQuery(turn.query, context.prior.turns) === null) {
    const budgetRefusal = await beforePalChatDeadline(context.deadline, () => paidSpendBudgetRefusal("pub-pal-chat"));
    if (budgetRefusal) return budgetRefusal;
  }

  if (acceptsPalChatStream(request.headers.get("accept"))) return streamTurn(turn, context, request);

  const outcome = await runTypedTurn(turn, context);

  if (!outcome.ok) {
    return publicApiError(PAL_ERROR_FALLBACK, "UNAVAILABLE", 503, { retryable: true });
  }

  return jsonNoStore(answerBody(outcome));
}
