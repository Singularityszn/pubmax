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
import { isAskToolName, isAskSourceKind, type AskMenuEvidence, type AskProposal, type AskTurn } from "@/lib/ask/types";
import { AuthActionSessionError, authedActionFetch } from "@/lib/authedFetch";
import { answerFromBody } from "@/lib/conciergeAskClient";
import {
  isPalChatStreamResponse,
  PAL_CHAT_STREAM_TYPE,
  readPalChatStream,
} from "@/lib/palChatStream";
import { recentPalSessionTurns, PAL_SESSION_RECENT_TURNS } from "@/lib/palSessionTurns";
import { isPubPalConversationId } from "@/lib/pubPalConversationId";
import { readProviderAccountSignal } from "@/lib/authProviderRevision";

export type PalChatResult =
  | (PalAnswer & { proposals: AskProposal[] })
  | { status: "error"; message: string; needsSignIn?: boolean };

export const PAL_CHAT_TIMEOUT_MS = 25_000;

type SessionOptions = {
  signal?: AbortSignal;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  initialTurns?: readonly AskTurn[];
  initialConversationId?: string;
  onConversationId?: (id: string) => void;
  onTurns?: (turns: AskTurn[]) => void;
};

const signedInFetch: typeof fetch = (input, init) =>
  authedActionFetch(input, init ?? {}, { requiresIdentity: true });

function cardTiming(item: Record<string, unknown>): Pick<PalCard, "when" | "confidence"> {
  const timing: Pick<PalCard, "when" | "confidence"> = {};
  if (typeof item.when === "string" && Number.isFinite(Date.parse(item.when))) timing.when = item.when;
  if (typeof item.confidence === "string") timing.confidence = item.confidence;
  return timing;
}

export function palChatResultFromBody(body: unknown): PalChatResult {
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
      const kind = isAskSourceKind(provenanceRaw?.kind) ? provenanceRaw.kind : "directory";
      cards.push({
        key:
          typeof item.key === "string" && item.key
            ? item.key
            : `ask-${index}`,
        venueId: typeof item.venueId === "string" ? item.venueId : "",
        title: typeof item.title === "string" ? item.title : "Result",
        place: typeof item.place === "string" ? item.place : "",
        note: typeof item.note === "string" ? item.note : "",
        ...(item.menuEvidence && typeof item.menuEvidence === "object" ? { menuEvidence: item.menuEvidence as AskMenuEvidence } : {}),
        ...cardTiming(item),
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
      ...(Array.isArray(record.toolsUsed) ? { toolsUsed: record.toolsUsed.filter((tool): tool is import("@/lib/ask/types").AskToolName => typeof tool === "string" && isAskToolName(tool)) } : {}),
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
  let activeController: AbortController | null = null;
  let turns: AskTurn[] = [...(options.initialTurns ?? [])];
  let threadId = options.initialConversationId && isPubPalConversationId(options.initialConversationId) ? options.initialConversationId : "";

  /**
   * `onText`, when given, asks for the streamed answer and is called with all of
   * the answer text so far as it arrives ("" clears a checking line). The result
   * is the same either way, and a server that answers one JSON body still works.
   */
  return async function ask(
    query: string,
    cityId: string,
    onText?: (text: string) => void,
  ): Promise<(PalChatResult & { routedQuery?: string }) | null> {
    const requestId = ++currentId;
    activeController?.abort();
    const accountSignal = readProviderAccountSignal();
    const controller = new AbortController();
    activeController = controller;
    const cancel = () => controller.abort();
    accountSignal.addEventListener("abort", cancel, { once: true });
    options.signal?.addEventListener("abort", cancel, { once: true });
    const cancelled = () => requestId !== currentId || accountSignal.aborted || options.signal?.aborted;
    try {
      if (cancelled()) return null;
      let timeoutId: ReturnType<typeof setTimeout>;
      let rejectAborted!: () => void;
      const deadline = new Promise<never>((_resolve, reject) => {
        rejectAborted = () => reject(new DOMException("Aborted", "AbortError"));
        controller.signal.addEventListener("abort", rejectAborted, { once: true });
        timeoutId = setTimeout(cancel, timeoutMs);
      });
      const withinDeadline = <T,>(work: Promise<T>): Promise<T> => Promise.race([work, deadline]);
      let response: Response;
      let body: unknown;
      let streamError: string | null = null;
      let routedQuery = query;
      try {
        const recent = await withinDeadline(recentPalSessionTurns(turns));
        const { refineRoutedAskQuery } = await withinDeadline(import("@/lib/ask/router"));
        const priorUsers = recent.filter((turn) => turn.role === "user").map((turn) => turn.content);
        routedQuery = refineRoutedAskQuery(query, priorUsers.at(-1), priorUsers);
        if (cancelled() || controller.signal.aborted) return null;
        response = await withinDeadline(fetchImpl("/api/pub-pal/chat", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(onText ? { accept: PAL_CHAT_STREAM_TYPE } : {}),
          },
          body: JSON.stringify({
            query,
            cityId,
            turns: recent.slice(-PAL_SESSION_RECENT_TURNS),
            ...(threadId ? { threadId } : {}),
          }),
          signal: controller.signal,
        }));
        if (response.ok && response.body && isPalChatStreamResponse(response)) {
          let text = "";
          let final: unknown = null;
          await withinDeadline(readPalChatStream(response.body, (event) => {
            if (event.type === "final") final = event.body;
            else if (event.type === "error") streamError = event.error;
            else {
              text = event.type === "delta" ? text + event.text : "";
              if (!cancelled() && !controller.signal.aborted) onText?.(text);
            }
          }));
          // A stream that ends without its final event was cut off.
          body = final;
          streamError ??= final === null ? PAL_ERROR_FALLBACK : null;
        } else {
          body = await withinDeadline(response.json());
        }
        if (cancelled() || controller.signal.aborted) return null;
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
        const result = palChatResultFromBody(body);
        const conversationId =
          body && typeof body === "object" && !Array.isArray(body)
            ? (body as Record<string, unknown>).conversationId
            : undefined;
        if (result.status !== "error") {
          const recent = await withinDeadline(recentPalSessionTurns([
            ...turns,
            { role: "user", content: query },
            { role: "assistant", content: result.message },
          ]));
          if (cancelled() || controller.signal.aborted) return null;
          turns = recent;
          options.onTurns?.(turns.map((turn) => ({ ...turn })));
        }
        if (typeof conversationId === "string" && (conversationId === "" || isPubPalConversationId(conversationId))) {
          threadId = conversationId;
          options.onConversationId?.(threadId);
        }
        return result.status === "error" ? result : { ...result, routedQuery };
      } finally {
        clearTimeout(timeoutId!);
        controller.signal.removeEventListener("abort", rejectAborted);
      }
    } catch (error) {
      if (cancelled()) return null;
      return {
        status: "error",
        message: error instanceof AuthActionSessionError ? error.message : PAL_ERROR_FALLBACK,
      };
    } finally {
      accountSignal.removeEventListener("abort", cancel);
      options.signal?.removeEventListener("abort", cancel);
      if (activeController === controller) activeController = null;
    }
  };
}
