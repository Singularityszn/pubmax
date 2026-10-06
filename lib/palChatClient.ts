// Pub Pal chat — client ask session over `/api/pub-pal/chat`.
// Latest-wins, timeout, curated errors. In-thread turns only (ADR 0014);
// durable Pal memory stays confirm-gated (ADR 0006). Never sends `narrated`.

import {
  DIRECTORY_PROVENANCE_LABEL,
  PAL_ERROR_FALLBACK,
  palAnswerFromBody,
  type PalAnswer,
  type PalCard,
} from "@/lib/palChat";
import type { AskProposal, AskTurn } from "@/lib/ask/types";
import { AuthActionSessionError, authedActionFetch } from "@/lib/authedFetch";
import { answerFromBody } from "@/lib/conciergeAskClient";
import {
  isPalChatStreamResponse,
  PAL_CHAT_STREAM_TYPE,
  readPalChatStream,
} from "@/lib/palChatStream";
import { isPubPalConversationId } from "@/lib/pubPalConversationId";

export type PalChatResult =
  | (PalAnswer & { proposals: AskProposal[] })
  | { status: "error"; message: string; needsSignIn?: boolean };

const PAL_CHAT_TIMEOUT_MS = 25_000;

type SessionOptions = {
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

const signedInFetch: typeof fetch = (input, init) =>
  authedActionFetch(input, init ?? {}, { requiresIdentity: true });

function askBodyToPal(body: unknown): PalChatResult {
  // Prefer the Ask agent shape when present.
  const ask = answerFromBody(body);
  if (ask.status === "error") return ask;

  if (
    body &&
    typeof body === "object" &&
    !Array.isArray(body) &&
    typeof (body as Record<string, unknown>).answer === "string"
  ) {
    const record = body as Record<string, unknown>;
    const rawCards = Array.isArray(record.cards) ? record.cards : [];
    const cards: PalCard[] = [];
    for (const [index, raw] of rawCards.entries()) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
      const item = raw as Record<string, unknown>;
      const provenanceRaw =
        item.provenance && typeof item.provenance === "object"
          ? (item.provenance as Record<string, unknown>)
          : null;
      const label =
        typeof provenanceRaw?.label === "string" && provenanceRaw.label.trim()
          ? provenanceRaw.label.trim()
          : DIRECTORY_PROVENANCE_LABEL;
      const kind =
        provenanceRaw?.kind === "whats-on" ? "whats-on" : "directory";
      cards.push({
        key:
          typeof item.key === "string" && item.key
            ? item.key
            : `ask-${index}`,
        venueId: typeof item.venueId === "string" ? item.venueId : "",
        title: typeof item.title === "string" ? item.title : "Result",
        place: typeof item.place === "string" ? item.place : "",
        note: typeof item.note === "string" ? item.note : "",
        price:
          typeof item.price === "number" && Number.isFinite(item.price)
            ? item.price
            : null,
        provenance: {
          label,
          kind,
          ...(typeof provenanceRaw?.url === "string"
            ? { url: provenanceRaw.url }
            : {}),
        },
      });
    }
    return {
      status: cards.length > 0 ? "answered" : "empty",
      message: ask.message,
      cards,
      proposals: ask.proposals,
    };
  }

  // Legacy concierge body.
  const legacy = palAnswerFromBody(body);
  return { ...legacy, proposals: [] };
}

/**
 * Create a chat ask session with latest-wins ordering and in-thread memory.
 */
export function createPalChatSession(options: SessionOptions = {}) {
  const timeoutMs = options.timeoutMs ?? PAL_CHAT_TIMEOUT_MS;
  const fetchImpl = options.fetchImpl ?? signedInFetch;
  let currentId = 0;
  const turns: AskTurn[] = [];
  let threadId = "";

  /**
   * `onText`, when given, asks for the streamed answer and is called with all of
   * the answer text so far as it arrives ("" clears a checking line). The result
   * is the same either way, and a server that answers one JSON body still works.
   */
  return async function ask(
    query: string,
    cityId: string,
    onText?: (text: string) => void,
  ): Promise<PalChatResult | null> {
    const requestId = ++currentId;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
      let response: Response;
      let body: unknown;
      let streamError: string | null = null;
      try {
        response = await fetchImpl("/api/pub-pal/chat", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(onText ? { accept: PAL_CHAT_STREAM_TYPE } : {}),
          },
          body: JSON.stringify({
            query,
            cityId,
            turns: turns.slice(-6),
            ...(threadId ? { threadId } : {}),
          }),
          signal: controller.signal,
        });
        if (response.ok && response.body && isPalChatStreamResponse(response)) {
          let text = "";
          let final: unknown = null;
          await readPalChatStream(response.body, (event) => {
            if (event.type === "final") final = event.body;
            else if (event.type === "error") streamError = event.error;
            else {
              text = event.type === "delta" ? text + event.text : "";
              if (requestId === currentId) onText?.(text);
            }
          });
          // A stream that ends without its final event was cut off.
          body = final;
          streamError ??= final === null ? PAL_ERROR_FALLBACK : null;
        } else {
          body = await response.json();
        }
      } finally {
        clearTimeout(timeoutId);
      }
      if (requestId !== currentId) return null;
      if (streamError !== null) return { status: "error", message: streamError };
      if (!response.ok) {
        const record =
          body && typeof body === "object" && !Array.isArray(body)
            ? (body as Record<string, unknown>)
            : {};
        return {
          status: "error",
          message:
            typeof record.error === "string" ? record.error : PAL_ERROR_FALLBACK,
          ...(response.status === 401 ? { needsSignIn: true } : {}),
        };
      }
      const result = askBodyToPal(body);
      const conversationId =
        body && typeof body === "object" && !Array.isArray(body)
          ? (body as Record<string, unknown>).conversationId
          : undefined;
      if (typeof conversationId === "string" && isPubPalConversationId(conversationId)) {
        threadId = conversationId;
      }
      if (result.status !== "error") {
        turns.push({ role: "user", content: query });
        turns.push({ role: "assistant", content: result.message });
        while (turns.length > 6) turns.shift();
      }
      return result;
    } catch (error) {
      if (requestId !== currentId) return null;
      return {
        status: "error",
        message: error instanceof AuthActionSessionError ? error.message : PAL_ERROR_FALLBACK,
      };
    }
  };
}
