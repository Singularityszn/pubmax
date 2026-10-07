import "server-only";

import { composeAnswer } from "@/lib/ask/runAsk";
import type { AskCard, AskProposal } from "@/lib/ask/types";
import { resolveAskCityId } from "@/lib/ask/tools";
import {
  readConfirmedPalMemories,
  palMemoryPreamble,
  type PalRecalledMemory,
} from "@/lib/palConfirmedMemories.server";
import { palSessionSummaryTurn, windowPalSessionTurns } from "@/lib/palSessionSummary";
import { fetchPalSignedConversation } from "@/lib/palElevenLabsSignedUrl.server";
import { isPubPalConversationId } from "@/lib/pubPalConversationId";
import {
  pubPalGetHomeRegisterAnswer,
  resolvePubPalFenceIntent,
  type PubPalFenceTurn,
} from "@/lib/pubPalLlmFence";
import {
  readOwnedPubPalToolTurn,
  readPubPalToolTurn,
  registerPubPalToolTurn,
  type PubPalToolTurn,
} from "@/lib/pubPalToolTurnStore";

const CHAT_TIMEOUT_MS = 22_000;
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
): Promise<PubPalToolTurn | null> {
  // A reply that ran no tool has no cards to wait for.
  if (!toolsRan) return readPubPalToolTurn(conversationId);
  const deadline = Date.now() + TOOL_TURN_WAIT_MS;
  while (Date.now() < deadline) {
    const peek = await readPubPalToolTurn(conversationId);
    if (
      peek &&
      (peek.cards.length > 0 || peek.proposals.length > 0 || peek.hints.length > 0)
    ) {
      return peek;
    }
    await sleep(TOOL_TURN_POLL_MS);
  }
  return readPubPalToolTurn(conversationId);
}

type PriorSession = { turns: PubPalFenceTurn[]; summary: string };

/**
 * The signed-in owner's earlier asks, read from their own stored turn and never
 * from the request. The newest stay word for word and older ones roll into the
 * session summary.
 */
async function priorOwnedSession(threadId: unknown, ownerId: string): Promise<PriorSession> {
  if (typeof threadId !== "string" || !isPubPalConversationId(threadId)) return { turns: [], summary: "" };
  const prior = await readOwnedPubPalToolTurn(threadId, ownerId);
  if (!prior) return { turns: [], summary: "" };
  const asks = [...prior.turns, { role: "user" as const, content: prior.query }].filter(
    (turn) => turn.role === "user" && turn.content.trim(),
  );
  return windowPalSessionTurns(prior.summary, asks);
}

/** The typed turn as the agent reads it: confirmed memories, the session summary, earlier asks, then the ask itself. */
function userMessageText(query: string, prior: PriorSession, memories: PalRecalledMemory[] | null): string {
  const priorAsks = prior.turns;
  return [
    ...palMemoryPreamble(memories),
    ...palSessionSummaryTurn(prior.summary),
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

export async function runPalElevenLabsChatTurn(
  input: PalElevenLabsChatInput,
): Promise<PalElevenLabsChatOutcome> {
  const apiKey = process.env.ELEVENLABS_API_KEY?.trim();
  const agentId = process.env.ELEVENLABS_PUB_PAL_AGENT_ID?.trim();
  if (!apiKey || !agentId) return { ok: false, code: "UNAVAILABLE" };

  const query = input.query.trim().slice(0, 500);
  if (!query) return { ok: false, code: "UNAVAILABLE" };
  const deadline = Date.now() + CHAT_TIMEOUT_MS;

  const cityId = resolveAskCityId(input.cityId);
  let prior: PriorSession;
  try {
    prior = await priorOwnedSession(input.threadId, input.ownerId);
  } catch {
    return { ok: false, code: "UNAVAILABLE" };
  }
  const turns = prior.turns;
  const fenceTurns = (input.fenceTurns ?? []).filter((turn) => turn.role === "user");
  const { fenced, sobrietyOnly } = await resolvePubPalFenceIntent(query, [
    ...fenceTurns,
    ...turns,
  ]);
  if (fenced) {
    return {
      ok: true,
      message: pubPalGetHomeRegisterAnswer("", sobrietyOnly),
      cards: [],
      proposals: [],
      conversationId: "",
      toolsUsed: [],
    };
  }

  // Read from the signed-in owner's own Pal, never from the request body. It never rejects.
  const memoriesRead = readConfirmedPalMemories(input.ownerId);

  const session = await fetchPalSignedConversation({ apiKey, agentId });
  if (!session.ok) return { ok: false, code: "PROVIDER_UNAVAILABLE" };
  const signedUrl = session.signedUrl;
  const memories = await memoriesRead;

  return new Promise((resolve) => {
    let settled = false;
    let conversationId = "";
    let userMessageSent = false;
    let latestReply = "";
    let replyGeneration = 0;
    let toolEvents = 0;
    let replyToolEvents = 0;
    const pendingToolCalls = new Set<string>();
    // The agent says a checking line before each tool call, so a reply is the
    // answer only when no tool event followed it and no tool is still running.
    const replyIsAnswer = () => replyToolEvents === toolEvents && pendingToolCalls.size === 0;
    const answer = (agentMessage: string, turn: PubPalToolTurn | null): PalElevenLabsChatOutcome => {
      const cards = turn?.cards ?? [];
      const proposals = turn?.proposals ?? [];
      const message =
        agentMessage ||
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
    };
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
        finish({ ok: false, code: "TIMEOUT" });
        return;
      }
      const agentMessage = latestReply;
      void (async () => {
        try {
          finish(answer(agentMessage, conversationId ? await readPubPalToolTurn(conversationId) : null));
        } catch {
          finish({ ok: false, code: "TIMEOUT" });
        }
      })();
    }, Math.max(0, deadline - Date.now()));

    const finish = (outcome: PalElevenLabsChatOutcome) => {
      if (settled) return;
      settled = true;
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
          const turn = conversationId ? await waitForPubPalToolTurn(conversationId, events > 0) : null;
          if (generation !== replyGeneration || events !== toolEvents) return;
          finish(answer(agentMessage, turn));
        } catch {
          finish({ ok: false, code: "UNAVAILABLE" });
        }
      })();
    };

    const ws = new WebSocket(signedUrl);

    const onAbort = () => finish({ ok: false, code: "TIMEOUT" });
    if (input.signal?.aborted) onAbort();
    input.signal?.addEventListener("abort", onAbort, { once: true });

    ws.addEventListener("open", () => {
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

    ws.addEventListener("message", (event) => {
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
        conversationId =
          payload.conversation_initiation_metadata_event?.conversation_id?.trim() ?? "";
        void (async () => {
          try {
            if (!isPubPalConversationId(conversationId)) {
              finish({ ok: false, code: "UNAVAILABLE" });
              return;
            }
            await registerPubPalToolTurn(conversationId, {
              query,
              cityId,
              ownerId: input.ownerId,
              turns,
              summary: prior.summary,
            });
            userMessageSent = true;
            ws.send(
              JSON.stringify({ type: "user_message", text: userMessageText(query, prior, memories) }),
            );
          } catch {
            finish({ ok: false, code: "UNAVAILABLE" });
          }
        })();
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
      finish({ ok: false, code: "PROVIDER_UNAVAILABLE" });
    });

    ws.addEventListener("close", () => {
      if (!settled) finish({ ok: false, code: "PROVIDER_UNAVAILABLE" });
    });
  });
}
