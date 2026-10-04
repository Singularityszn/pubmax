import "server-only";

import { composeAnswer } from "@/lib/ask/runAsk";
import { isAskToolName, type AskCard, type AskProposal } from "@/lib/ask/types";
import { resolveAskCityId } from "@/lib/ask/tools";
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

const CHAT_TIMEOUT_MS = 28_000;
const TOOL_TURN_WAIT_MS = 4_000;
const TOOL_TURN_POLL_MS = 120;

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForPubPalToolTurn(conversationId: string): Promise<PubPalToolTurn | null> {
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

/** The signed-in owner's earlier asks, read from their own stored turn and never from the request. */
async function priorOwnedAsks(threadId: unknown, ownerId: string): Promise<PubPalFenceTurn[]> {
  if (typeof threadId !== "string" || !isPubPalConversationId(threadId)) return [];
  const prior = await readOwnedPubPalToolTurn(threadId, ownerId);
  if (!prior) return [];
  return [...prior.turns, { role: "user" as const, content: prior.query }]
    .filter((turn) => turn.role === "user" && turn.content.trim())
    .slice(-6);
}

function userMessageText(query: string, priorAsks: PubPalFenceTurn[]): string {
  if (priorAsks.length === 0) return query;
  return [
    "My earlier asks in this chat, oldest first:",
    ...priorAsks.map((turn) => `- ${turn.content}`),
    `Now: ${query}`,
  ].join("\n");
}

type AgentResponseEvent = {
  type?: string;
  agent_tool_response?: { tool_name?: string; is_called?: boolean; is_error?: boolean };
  agent_response_event?: { agent_response?: string };
  ping_event?: { event_id?: number };
  conversation_initiation_metadata_event?: {
    conversation_id?: string;
  };
};

async function fetchSignedConversationUrl(apiKey: string, agentId: string): Promise<string> {
  const url = new URL("https://api.elevenlabs.io/v1/convai/conversation/get-signed-url");
  url.searchParams.set("agent_id", agentId);
  url.searchParams.set("include_conversation_id", "true");
  const response = await fetch(url, {
    headers: { "xi-api-key": apiKey },
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error("PROVIDER_UNAVAILABLE");
  }
  const payload = (await response.json()) as { signed_url?: string };
  if (!payload.signed_url) throw new Error("PROVIDER_UNAVAILABLE");
  return payload.signed_url;
}

export type PalElevenLabsChatInput = {
  query: string;
  cityId?: unknown;
  /** The previous answer's conversation id. Only the owner's own stored row is read. */
  threadId?: unknown;
  /** Browser-sent user turns. They may only add a get-home fence, never reach the model or the store. */
  fenceTurns?: PubPalFenceTurn[];
  ownerId: string;
};

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

  const cityId = resolveAskCityId(input.cityId);
  let turns: PubPalFenceTurn[];
  try {
    turns = await priorOwnedAsks(input.threadId, input.ownerId);
  } catch {
    return { ok: false, code: "UNAVAILABLE" };
  }
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

  let signedUrl: string;
  try {
    signedUrl = await fetchSignedConversationUrl(apiKey, agentId);
  } catch {
    return { ok: false, code: "PROVIDER_UNAVAILABLE" };
  }

  return new Promise((resolve) => {
    let settled = false;
    let conversationId = "";
    let userMessageSent = false;
    // Tools the agent reports it ran. The webhook stores their results, but
    // toolsUsed must not depend on that write landing before the reply.
    const calledTools: string[] = [];
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      ws.close();
      resolve({ ok: false, code: "TIMEOUT" });
    }, CHAT_TIMEOUT_MS);

    const finish = (outcome: PalElevenLabsChatOutcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        // ignore
      }
      resolve(outcome);
    };

    const ws = new WebSocket(signedUrl);

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
            });
            userMessageSent = true;
            ws.send(
              JSON.stringify({ type: "user_message", text: userMessageText(query, turns) }),
            );
          } catch {
            finish({ ok: false, code: "UNAVAILABLE" });
          }
        })();
        return;
      }

      if (payload.type === "agent_tool_response") {
        const tool = payload.agent_tool_response;
        const name = tool?.tool_name?.trim() ?? "";
        if (
          userMessageSent &&
          tool?.is_called !== false &&
          !tool?.is_error &&
          isAskToolName(name) &&
          !calledTools.includes(name)
        ) {
          calledTools.push(name);
        }
        return;
      }

      if (payload.type === "agent_response") {
        if (!userMessageSent) return;
        const agentMessage = payload.agent_response_event?.agent_response?.trim() ?? "";
        void (async () => {
          try {
            const turn = conversationId ? await waitForPubPalToolTurn(conversationId) : null;
            const cards = turn?.cards ?? [];
            const proposals = turn?.proposals ?? [];
            const message =
              agentMessage ||
              (turn?.hints.length
                ? composeAnswer(turn.hints, cards, [])
                : cards.length > 0
                  ? composeAnswer([], cards, [])
                  : "Nothing sourced for that. Try a nearby area or a broader ask.");
            finish({
              ok: true,
              message,
              cards,
              proposals,
              conversationId,
              toolsUsed: [...new Set([...(turn?.toolsUsed ?? []), ...calledTools])],
            });
          } catch {
            finish({ ok: false, code: "UNAVAILABLE" });
          }
        })();
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
