import "server-only";

import { extractExplicitBudget } from "@/lib/concierge/intentPolicy";
import { composeAnswer, runAsk } from "@/lib/ask/runAsk";
import { recordedDrinkComparison, refineRoutedAskQuery, resolveAskPriceIntent, routeAskDeterministically, unsupportedPriceComparison } from "@/lib/ask/router";
import type { AskCard, AskProposal } from "@/lib/ask/types";
import { resolveAskCityId } from "@/lib/ask/tools";
import {
  readConfirmedPalMemories,
  palMemoryPreamble,
  type PalRecalledMemory,
} from "@/lib/palConfirmedMemories.server";
import { palSessionSummaryTurn, windowPalSessionTurns } from "@/lib/palSessionSummary";
import { palTastePreamble, type PalTaste } from "@/lib/palTaste";
import { readPalTaste } from "@/lib/palTaste.server";
import { fetchPalSignedConversation, type PalSignedConversation } from "@/lib/palElevenLabsSignedUrl.server";
import { log } from "@/lib/log";
import { isPubPalConversationId, newPalLocalThreadId } from "@/lib/pubPalConversationId";
import {
  pubPalGetHomeRegisterAnswer,
  resolvePubPalFenceIntent,
  type PubPalFenceIntent,
  type PubPalFenceTurn,
} from "@/lib/pubPalLlmFence";
import {
  readOwnedPubPalToolTurn,
  readPubPalToolTurn,
  registerPubPalToolTurn,
  type PubPalToolTurn,
} from "@/lib/pubPalToolTurnStore";

import { PAL_CHAT_TIMEOUT_MS as CHAT_TIMEOUT_MS, PalChatDeadlineExceeded, assertPalChatDeadline, beforePalChatDeadline } from "@/lib/palChatDeadline";
const LOCAL_TURN_WRITE_BUDGET_MS = 1_500;
const TOOL_TURN_WAIT_MS = 4_000;
const TOOL_TURN_POLL_MS = 120;
// A reply is the answer once this long has passed with no tool event after it.
// The agent says its checking line, then asks for the tool within a beat, so a
// quiet window this long separates the line from the answer. It is what ends a
// turn on an agent that never sends agent_response_complete, so a deploy and an
// agent re-run are safe in either order.
const REPLY_SETTLE_MS = 1_200;
// The turn-end event says the agent has finished speaking, so the window after
// it only has to cover a tool request that trails it.
const TURN_END_SETTLE_MS = 400;

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForPubPalToolTurn(
  conversationId: string,
  toolsRan: boolean,
  turnDeadline: number,
): Promise<PubPalToolTurn | null> {
  const read = () => beforePalChatDeadline(turnDeadline, () => readPubPalToolTurn(conversationId));
  // A reply that ran no tool has no cards to wait for.
  if (!toolsRan) return read();
  const deadline = Math.min(turnDeadline, Date.now() + TOOL_TURN_WAIT_MS);
  while (Date.now() < deadline) {
    const peek = await read();
    if (
      peek &&
      (peek.cards.length > 0 || peek.proposals.length > 0 || peek.hints.length > 0)
    ) {
      return peek;
    }
    await sleep(Math.min(TOOL_TURN_POLL_MS, Math.max(0, deadline - Date.now())));
  }
  return read();
}

type PriorSession = { turns: PubPalFenceTurn[]; summary: string; conversationId?: string; ownedTurn?: PubPalToolTurn };

/**
 * Read earlier context from the signed-in owner's stored turn, never the request.
 * The shared session window resolves same-area budget references before eviction.
 */
async function priorOwnedSession(threadId: unknown, ownerId: string): Promise<PriorSession> {
  if (typeof threadId !== "string" || !isPubPalConversationId(threadId)) return { turns: [], summary: "" };
  const prior = await readOwnedPubPalToolTurn(threadId, ownerId);
  if (!prior) return { turns: [], summary: "" };
  const asks = [...prior.turns, { role: "user" as const, content: prior.query }].filter(
    (turn) => turn.content.trim(),
  );
  return { ...windowPalSessionTurns(prior.summary, asks), conversationId: threadId, ownedTurn: prior };
}

/**
 * Everything a typed turn tells the agent about the person: their confirmed
 * memories, then the taste read from their own logs. The memory eval
 * (evals/pal/memory) grades exactly these lines.
 */
export function palPersonalContext(memories: PalRecalledMemory[] | null, taste: PalTaste | null): string[] {
  return [...palMemoryPreamble(memories), ...palTastePreamble(taste)];
}

/** The typed turn as the model reads it: the personal context, the session summary, earlier asks, then the ask itself. */
export function palUserMessageText(
  query: string,
  prior: PriorSession,
  memories: PalRecalledMemory[] | null,
  taste: PalTaste | null,
): string {
  const priorAsks = prior.turns.filter((turn) => turn.role === "user");
  return [
    ...palPersonalContext(memories, taste),
    ...palSessionSummaryTurn(prior.summary),
    ...prior.turns.filter((turn) => turn.role === "assistant").map((turn) => `Earlier Pal opening in this conversation: ${turn.content}`),
    ...(priorAsks.length > 0
      ? ["My earlier asks in this chat, oldest first:", ...priorAsks.map((turn) => `- ${turn.content}`)]
      : []),
    `Current user message: ${query}`,
  ].join("\n");
}

type AgentResponseEvent = {
  type?: string;
  agent_response_event?: { agent_response?: string };
  text_response_part?: { type?: string; text?: string };
  agent_tool_request?: { tool_call_id?: string };
  agent_tool_response?: { tool_call_id?: string };
  ping_event?: { event_id?: number };
  conversation_initiation_metadata_event?: {
    conversation_id?: string;
  };
};

export type PalElevenLabsChatInput = {
  query: string;
  cityId?: unknown;
  /** The previous answer's conversation id. Only the owner's own stored row is read. */
  threadId?: unknown;
  /** Browser-sent user turns. They may only add a get-home fence, never reach the model or the store. */
  fenceTurns?: PubPalFenceTurn[];
  ownerId: string;
  /**
   * Called as the agent writes its reply: `delta` carries more text, `reset` says
   * what was sent so far was a checking line before a tool and should be cleared.
   * The outcome still carries the whole answer, so a caller may ignore this.
   */
  onProgress?: (event: PalElevenLabsChatProgress) => void;
  /** Ends the turn and closes the agent socket, for a caller that has gone away. */
  signal?: AbortSignal;
};

type PalElevenLabsChatProgress = { type: "delta"; text: string } | { type: "reset" };

export type PalElevenLabsChatOutcome =
  | {
      ok: true;
      message: string;
      cards: AskCard[];
      proposals: AskProposal[];
      conversationId: string;
      toolsUsed: string[];
    }
  | { ok: false; code: "UNAVAILABLE" | "TIMEOUT" | "PROVIDER_UNAVAILABLE" };

type PalChatFailureStage =
  | "configuration" | "input" | "context" | "signed_url" | "registration"
  | "tool_result" | "deadline" | "caller_cancel" | "socket_error" | "socket_close" | "turn"
  | "model";

export type PalChatFailureRecorder = (
  code: Extract<PalElevenLabsChatOutcome, { ok: false }>["code"],
  stage: PalChatFailureStage,
  reason?: Extract<PalSignedConversation, { ok: false }>["reason"],
) => void;

/** Logs a failed turn once, with its stage and duration. A cancelled caller is not a failure. */
export function palChatFailureRecorder(input: PalElevenLabsChatInput, startedAt = Date.now()): PalChatFailureRecorder {
  return (code, stage, reason) => {
    if (input.signal?.aborted || stage === "caller_cancel") return;
    log("warn", "pub_pal.chat_failed", {
      code,
      stage,
      ...(reason ? { reason } : {}),
      durationMs: Math.max(0, Date.now() - startedAt),
    });
  };
}

export type PalElevenLabsChatContext = {
  prior: PriorSession;
  fence: PubPalFenceIntent;
  deadline: number;
};

/** Prepare owned history and its safety result once, before any opening or provider turn. */
export async function preparePalElevenLabsChatTurn(
  input: PalElevenLabsChatInput,
  deadline = Date.now() + CHAT_TIMEOUT_MS,
): Promise<PalElevenLabsChatContext> {
  return beforePalChatDeadline(deadline, async () => {
    const prior = await priorOwnedSession(input.threadId, input.ownerId);
    assertPalChatDeadline(deadline);
    const fenceTurns = (input.fenceTurns ?? []).filter((turn) => turn.role === "user");
    const fence = await resolvePubPalFenceIntent(input.query.trim().slice(0, 500), [
      ...fenceTurns,
      ...prior.turns,
    ]);
    return { prior, fence, deadline };
  });
}

/** The validated read-only pint/menu asks that need no provider narration. */
export function palChatRecordQuery(query: string, turns: readonly PubPalFenceTurn[] = []): string | null {
  const priorAsks = turns.filter((turn) => turn.role === "user").map((turn) => turn.content);
  const routedQuery = refineRoutedAskQuery(query, priorAsks.at(-1), priorAsks);
  if (unsupportedPriceComparison(routedQuery) || recordedDrinkComparison(routedQuery)) return routedQuery;
  const intent = resolveAskPriceIntent(routedQuery);
  const calls = routeAskDeterministically(routedQuery);
  // Listed pint discovery is local. Keep mixed requests and other tools on
  // their own paths rather than dropping a sibling request to gain speed.
  const pintBudget = /\bpints?\b/i.test(routedQuery) && extractExplicitBudget(routedQuery) !== undefined;
  return (intent.kind === "pint" || (intent.kind === "none" && pintBudget)) && calls.length > 0
    && calls.every((call) => call.name === "search_venues" || call.name === "cheapest_pint_near")
    ? routedQuery : null;
}

/** A turn that needs a model: the checked ask, its owned history, and the personal reads already started. */
export type PalChatProviderTurn = {
  query: string;
  cityId: ReturnType<typeof resolveAskCityId>;
  deadline: number;
  prior: PriorSession;
  memoriesRead: ReturnType<typeof readConfirmedPalMemories>;
  tasteRead: ReturnType<typeof readPalTaste>;
};

/**
 * Everything a typed turn does before any provider is asked, for every
 * provider: the owned history, the safety fence, and the asks the records
 * answer alone. Returns the finished outcome for those, or the turn a model
 * must answer, with the memory and taste reads already running.
 */
export async function preparePalChatProviderTurn(
  input: PalElevenLabsChatInput,
  context: PalElevenLabsChatContext | undefined,
  recordFailure: PalChatFailureRecorder,
): Promise<{ outcome: PalElevenLabsChatOutcome } | { turn: PalChatProviderTurn }> {
  const query = input.query.trim().slice(0, 500);
  if (!query) {
    recordFailure("UNAVAILABLE", "input");
    return { outcome: { ok: false, code: "UNAVAILABLE" } };
  }
  const deadline = context?.deadline ?? Date.now() + CHAT_TIMEOUT_MS;

  const cityId = resolveAskCityId(input.cityId);
  // A price comparison the records answer opens no provider session (below),
  // and the test is on the ask alone, so it is decided before anything leaves.
  const unsupported = unsupportedPriceComparison(query);
  try {
    context ??= await preparePalElevenLabsChatTurn(input, deadline);
  } catch (error) {
    const code = error instanceof PalChatDeadlineExceeded ? "TIMEOUT" : "UNAVAILABLE";
    recordFailure(code, "context");
    return { outcome: { ok: false, code } };
  }
  const { prior, fence: { fenced, sobrietyOnly } } = context;
  if (Date.now() >= deadline) {
    recordFailure("TIMEOUT", "context");
    return { outcome: { ok: false, code: "TIMEOUT" } };
  }
  const recordQuery = palChatRecordQuery(query, prior.turns);
  if (fenced) {
    return {
      outcome: {
        ok: true,
        message: pubPalGetHomeRegisterAnswer("", sobrietyOnly),
        cards: [],
        proposals: [],
        conversationId: "",
        toolsUsed: [],
      },
    };
  }

  if (recordQuery === null) {
    // Only unfenced provider turns read the person. Read from the signed-in
    // owner's own Pal and logs, never from the request body.
    return {
      turn: {
        query,
        cityId,
        deadline,
        prior,
        memoriesRead: readConfirmedPalMemories(input.ownerId, query),
        tasteRead: readPalTaste(input.ownerId),
      },
    };
  }

  let result: Awaited<ReturnType<typeof runAsk>>;
  try {
    result = await beforePalChatDeadline(deadline, () => runAsk({ query: recordQuery, cityId, skipModel: true }));
  } catch (error) {
    const code = error instanceof PalChatDeadlineExceeded ? "TIMEOUT" : "UNAVAILABLE";
    recordFailure(code, "tool_result");
    return { outcome: { ok: false, code } };
  }
  // A first answer from the records opens no provider session, so it gets a
  // local thread: the follow-up reads this turn back instead of starting blind.
  let threadId = unsupported ? "" : prior.conversationId ?? newPalLocalThreadId();
  let historyUnavailable = false;
  if (threadId) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const stored = await Promise.race([
        registerPubPalToolTurn(threadId, {
          deadline,
          query, cityId, ownerId: input.ownerId, turns: prior.turns, summary: prior.summary,
          cards: result.cards, proposals: result.proposals, hints: [result.answer], toolsUsed: result.toolsUsed,
        }).then(() => true, () => false),
        new Promise<false>((resolve) => {
          timer = setTimeout(() => resolve(false), Math.min(LOCAL_TURN_WRITE_BUDGET_MS, Math.max(0, deadline - Date.now())));
        }),
      ]);
      if (!stored) {
        // A public record answer needs no persisted conversation. Clear the
        // client correlation so a later ask cannot rely on a missing turn.
        threadId = "";
        historyUnavailable = true;
        recordFailure("UNAVAILABLE", "registration");
      }
    } finally {
      clearTimeout(timer);
    }
  }
  return {
    outcome: {
      ok: true,
      message: historyUnavailable ? `${result.answer} Conversation history could not be kept. Name the area again in your next ask.` : result.answer,
      cards: result.cards,
      proposals: result.proposals,
      conversationId: threadId,
      toolsUsed: result.toolsUsed,
    },
  };
}

/**
 * The finished answer: the model's own reply when it wrote one, else the
 * stored tool hints or cards, else a plain nothing-sourced line.
 */
export function palChatAnswer(
  modelMessage: string,
  turn: PubPalToolTurn | null,
  conversationId: string,
): Extract<PalElevenLabsChatOutcome, { ok: true }> {
  const cards = turn?.cards ?? [];
  const proposals = turn?.proposals ?? [];
  const message =
    modelMessage ||
    (turn?.hints.length
      ? composeAnswer(turn.hints, cards, [])
      : cards.length > 0
        ? composeAnswer([], cards, [])
        : "Nothing sourced for that. Try a nearby area or a broader ask.");
  return {
    ok: true,
    message,
    cards,
    proposals,
    conversationId,
    toolsUsed: turn?.toolsUsed ?? [],
  };
}

export async function runPalElevenLabsChatTurn(
  input: PalElevenLabsChatInput,
  context?: PalElevenLabsChatContext,
): Promise<PalElevenLabsChatOutcome> {
  const recordFailure = palChatFailureRecorder(input);
  const apiKey = process.env.ELEVENLABS_API_KEY?.trim();
  const agentId = process.env.ELEVENLABS_PUB_PAL_AGENT_ID?.trim();
  if (!apiKey || !agentId) {
    recordFailure("UNAVAILABLE", "configuration");
    return { ok: false, code: "UNAVAILABLE" };
  }

  const prepared = await preparePalChatProviderTurn(input, context, recordFailure);
  if ("outcome" in prepared) return prepared.outcome;
  const { query, cityId, deadline, prior, memoriesRead, tasteRead } = prepared.turn;
  const turns = prior.turns;
  const sessionRead = fetchPalSignedConversation({
    apiKey, agentId, timeoutMs: Math.max(1, deadline - Date.now()),
  });

  let session: PalSignedConversation;
  try {
    session = await beforePalChatDeadline(deadline, () => sessionRead);
  } catch {
    recordFailure("TIMEOUT", "signed_url");
    return { ok: false, code: "TIMEOUT" };
  }
  if (!session.ok) {
    recordFailure("PROVIDER_UNAVAILABLE", "signed_url", session.reason);
    return { ok: false, code: "PROVIDER_UNAVAILABLE" };
  }
  const signedUrl = session.signedUrl;
  const registerTurn = (id: string) =>
    registerPubPalToolTurn(id, {
      deadline,
      query,
      cityId,
      ownerId: input.ownerId,
      turns,
      summary: prior.summary,
    });
  // The signed URL already names the conversation, so the turn is registered
  // while the socket opens rather than after the agent's metadata arrives. The
  // metadata is still what decides: a different id there registers that one.
  const earlyConversationId = session.conversationId;
  const earlyRegistration = registerTurn(earlyConversationId);
  // Awaited below; this only stops a socket that fails first from leaving the
  // rejection unhandled.
  earlyRegistration.catch(() => {});

  return new Promise((resolve) => {
    let settled = false;
    let conversationId = "";
    let metadataReceived = false;
    let userMessageSent = false;
    let latestReply = "";
    let replyGeneration = 0;
    let toolEvents = 0;
    let replyToolEvents = 0;
    const pendingToolCalls = new Set<string>();
    // The agent says a checking line before each tool call, so a reply is the
    // answer only when no tool event followed it and no tool is still running.
    const replyIsAnswer = () => replyToolEvents === toolEvents && pendingToolCalls.size === 0;
    const answer = (agentMessage: string, turn: PubPalToolTurn | null): PalElevenLabsChatOutcome =>
      palChatAnswer(agentMessage, turn, conversationId);
    // Text sent to the caller since the last reset. A tool event or a newer reply
    // makes it a checking line, so the caller is told to clear it.
    let streamedText = false;
    const resetStream = () => {
      if (!streamedText) return;
      streamedText = false;
      input.onProgress?.({ type: "reset" });
    };
    let settleTimer: ReturnType<typeof setTimeout> | null = null;
    const clearSettle = () => {
      if (settleTimer) clearTimeout(settleTimer);
      settleTimer = null;
    };
    // Finish on the latest reply once nothing has followed it for `ms`. A tool
    // event or a newer reply in the window clears or re-arms this.
    const armSettle = (ms: number) => {
      clearSettle();
      settleTimer = setTimeout(() => {
        settleTimer = null;
        if (!settled && latestReply && replyIsAnswer()) finishWithLatestReply();
      }, ms);
    };
    const timer = setTimeout(() => {
      if (settled) return;
      if (!latestReply || !replyIsAnswer()) {
        finish({ ok: false, code: "TIMEOUT" }, "deadline");
        return;
      }
      finish(answer(latestReply, null));
    }, Math.max(0, deadline - Date.now()));

    const finish = (outcome: PalElevenLabsChatOutcome, failureStage: PalChatFailureStage = "turn") => {
      if (settled) return;
      settled = true;
      if (!outcome.ok) recordFailure(outcome.code, failureStage);
      clearTimeout(timer);
      clearSettle();
      try {
        ws.close();
      } catch {
        // ignore
      }
      resolve(outcome);
    };

    const finishWithLatestReply = () => {
      const agentMessage = latestReply;
      const generation = replyGeneration;
      const events = toolEvents;
      void (async () => {
        try {
          const turn = conversationId ? await waitForPubPalToolTurn(conversationId, events > 0, deadline) : null;
          if (generation !== replyGeneration || events !== toolEvents) return;
          finish(answer(agentMessage, turn));
        } catch (error) {
          // The main deadline timer preserves an eligible reply and closes the socket.
          if (error instanceof PalChatDeadlineExceeded) return;
          finish({ ok: false, code: "UNAVAILABLE" }, "tool_result");
        }
      })();
    };

    const ws = new WebSocket(signedUrl);

    const onAbort = () => finish({ ok: false, code: "TIMEOUT" }, "caller_cancel");
    if (input.signal?.aborted) onAbort();
    input.signal?.addEventListener("abort", onAbort, { once: true });

    ws.addEventListener("open", () => {
      if (settled || Date.now() >= deadline) return;
      ws.send(
        JSON.stringify({
          type: "conversation_initiation_client_data",
          conversation_config_override: {
            agent: {
              first_message: "",
            },
            conversation: {
              text_only: true,
              client_events: [
                "agent_response",
                "agent_response_complete",
                "agent_tool_request",
                "agent_tool_response",
                "conversation_initiation_metadata",
                "ping",
              ],
            },
          },
        }),
      );
    });

    const receiveMetadata = (id: string | undefined): void => {
      if (settled || Date.now() >= deadline || metadataReceived) return;
      metadataReceived = true;
      conversationId = id?.trim() ?? "";
      void (async () => {
        try {
          if (!isPubPalConversationId(conversationId)) {
            finish({ ok: false, code: "UNAVAILABLE" }, "registration");
            return;
          }
          const [, memories, taste] = await Promise.all([
            conversationId === earlyConversationId
              ? earlyRegistration
              : registerTurn(conversationId),
            memoriesRead,
            tasteRead,
          ]);
          if (settled || Date.now() >= deadline) return;
          userMessageSent = true;
          ws.send(
            JSON.stringify({ type: "user_message", text: palUserMessageText(query, prior, memories, taste) }),
          );
        } catch {
          finish({ ok: false, code: "UNAVAILABLE" }, "registration");
        }
      })();
    };

    ws.addEventListener("message", (event) => {
      if (settled || Date.now() >= deadline) return;
      let payload: AgentResponseEvent;
      try {
        payload = JSON.parse(String(event.data)) as AgentResponseEvent;
      } catch {
        return;
      }

      if (payload.type === "ping") {
        ws.send(
          JSON.stringify({
            type: "pong",
            event_id: payload.ping_event?.event_id ?? 0,
          }),
        );
        return;
      }

      if (payload.type === "conversation_initiation_metadata") {
        receiveMetadata(payload.conversation_initiation_metadata_event?.conversation_id);
        return;
      }

      if (payload.type === "agent_chat_response_part") {
        if (!userMessageSent) return;
        const part = payload.text_response_part;
        if (part?.type === "start") {
          resetStream();
        } else if (part?.type === "delta" && part.text) {
          streamedText = true;
          input.onProgress?.({ type: "delta", text: part.text });
        }
        return;
      }

      if (payload.type === "agent_response") {
        if (!userMessageSent) return;
        const reply = payload.agent_response_event?.agent_response?.trim() ?? "";
        if (!reply) return;
        latestReply = reply;
        replyGeneration += 1;
        replyToolEvents = toolEvents;
        // The reply is the answer unless a tool event follows it in the window.
        armSettle(REPLY_SETTLE_MS);
        return;
      }

      if (payload.type === "agent_tool_request") {
        if (!userMessageSent) return;
        clearSettle();
        resetStream();
        toolEvents += 1;
        pendingToolCalls.add(payload.agent_tool_request?.tool_call_id ?? "");
        return;
      }

      if (payload.type === "agent_tool_response") {
        if (!userMessageSent) return;
        clearSettle();
        resetStream();
        toolEvents += 1;
        pendingToolCalls.delete(payload.agent_tool_response?.tool_call_id ?? "");
        return;
      }

      if (payload.type === "agent_response_complete") {
        if (!userMessageSent || !latestReply || !replyIsAnswer()) return;
        armSettle(TURN_END_SETTLE_MS);
      }
    });

    ws.addEventListener("error", () => {
      finish({ ok: false, code: "PROVIDER_UNAVAILABLE" }, "socket_error");
    });

    ws.addEventListener("close", () => {
      if (!settled) finish({ ok: false, code: "PROVIDER_UNAVAILABLE" }, "socket_close");
    });
  });
}
