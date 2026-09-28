import "server-only";

import { composeAnswer } from "@/lib/ask/runAsk";
import type { AskCard, AskProposal, AskTurn } from "@/lib/ask/types";
import { resolveAskCityId } from "@/lib/ask/tools";
import {
  pubPalGetHomeRegisterAnswer,
  resolvePubPalFenceIntent,
} from "@/lib/pubPalLlmFence";
import {
  consumePubPalToolTurn,
  readPubPalToolTurn,
  registerPubPalToolTurn,
} from "@/lib/pubPalToolTurnStore";

const CHAT_TIMEOUT_MS = 28_000;
const TOOL_TURN_WAIT_MS = 4_000;
const TOOL_TURN_POLL_MS = 120;


async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForPubPalToolTurn(conversationId: string): Promise<Awaited<ReturnType<typeof consumePubPalToolTurn>>> {
  const deadline = Date.now() + TOOL_TURN_WAIT_MS;
  while (Date.now() < deadline) {
    const peek = await readPubPalToolTurn(conversationId);
    if (
      peek &&
      (peek.cards.length > 0 || peek.proposals.length > 0 || peek.hints.length > 0)
    ) {
      break;
    }
    await sleep(TOOL_TURN_POLL_MS);
  }
  return consumePubPalToolTurn(conversationId);
}

type AgentResponseEvent = {
  type?: string;
  agent_response_event?: { agent_response?: string };
  ping_event?: { event_id?: number };
  conversation_initiation_metadata_event?: {
    conversation_id?: string;
  };
};

function recentTurnsSummary(turns: AskTurn[]): string {
  if (turns.length === 0) return "";
  return turns
    .slice(-6)
    .map((turn) => `${turn.role === "user" ? "User" : "Pal"}: ${turn.content}`)
    .join("\n");
}

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
  turns?: AskTurn[];
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
  const turns = Array.isArray(input.turns) ? input.turns : [];
  const { fenced, sobrietyOnly } = await resolvePubPalFenceIntent(query, turns);
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
              client_events: ["agent_response", "conversation_initiation_metadata", "ping"],
            },
          },
          dynamic_variables: {
            pubmax_city_id: cityId,
            pubmax_recent_turns: recentTurnsSummary(turns),
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
            if (conversationId) {
              await registerPubPalToolTurn(conversationId, {
                query,
                cityId,
                turns: turns.map((turn) => ({
                  role: turn.role,
                  content: turn.content,
                })),
              });
            }
            userMessageSent = true;
            ws.send(JSON.stringify({ type: "user_message", text: query }));
          } catch {
            finish({ ok: false, code: "UNAVAILABLE" });
          }
        })();
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
              toolsUsed: turn?.toolsUsed ?? [],
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
