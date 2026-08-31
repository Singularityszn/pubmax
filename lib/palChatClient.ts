// Pub Pal chat — client ask session over Night OS Ask (`/api/ask`).
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
import { answerFromBody } from "@/lib/conciergeAskClient";

export type PalChatResult =
  | (PalAnswer & { proposals: AskProposal[] })
  | { status: "error"; message: string };

export const PAL_CHAT_TIMEOUT_MS = 12_000;

type SessionOptions = {
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

const ASK_SOURCE_KINDS = new Set([
  "directory",
  "whats-on",
  "heritage",
  "community-price",
  "citymcp",
  "plan",
]);

function isAskSource(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  return typeof value.label === "string"
    && Boolean(value.label.trim())
    && typeof value.kind === "string"
    && ASK_SOURCE_KINDS.has(value.kind)
    && (value.url === undefined || typeof value.url === "string");
}

function sameAskSource(
  left: Record<string, unknown>,
  right: Record<string, unknown>,
): boolean {
  return left.label === right.label
    && left.kind === right.kind
    && (left.url ?? "") === (right.url ?? "");
}

function isAskCard(
  value: unknown,
  sources: readonly Record<string, unknown>[],
): boolean {
  if (!isRecord(value)) return false;
  const provenance = value.provenance;
  if (!isAskSource(provenance)) return false;
  const validPrice = value.price === null
    || (typeof value.price === "number" && Number.isFinite(value.price));
  return typeof value.key === "string"
    && Boolean(value.key.trim())
    && typeof value.venueId === "string"
    && typeof value.title === "string"
    && Boolean(value.title.trim())
    && typeof value.place === "string"
    && typeof value.note === "string"
    && validPrice
    && sources.some((source) => sameAskSource(source, provenance));
}

function isOfficialAskBody(record: Record<string, unknown>): boolean {
  const sources = Array.isArray(record.sources)
    ? record.sources.filter(isAskSource)
    : [];
  return typeof record.answer === "string"
    && Boolean(record.answer.trim())
    && Array.isArray(record.cards)
    && record.cards.every((card) => isAskCard(card, sources))
    && Array.isArray(record.proposals)
    && Array.isArray(record.sources)
    && sources.length === record.sources.length
    && (record.status === "ready" || record.status === "degraded")
    && Array.isArray(record.toolsUsed)
    && record.toolsUsed.every((tool) => typeof tool === "string" && Boolean(tool));
}

function askBodyToPal(body: unknown): PalChatResult {
  if (!isRecord(body)) {
    return { status: "error", message: PAL_ERROR_FALLBACK };
  }
  const record = body;

  if (isOfficialAskBody(record)) {
    const ask = answerFromBody(record);
    if (ask.status === "error") return ask;
    if (
      !Array.isArray(record.proposals)
      || ask.proposals.length !== record.proposals.length
    ) {
      return { status: "error", message: PAL_ERROR_FALLBACK };
    }
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

  const legacyRows = record.mode === "whats-on"
    ? (Array.isArray(record.listings) ? record.listings : null)
    : (Array.isArray(record.venues) ? record.venues : null);
  if (!legacyRows) {
    return { status: "error", message: PAL_ERROR_FALLBACK };
  }

  // Empty legacy arrays are an honest empty result. A non-empty array whose
  // rows all fail provenance/name validation is a malformed success response.
  const legacy = palAnswerFromBody(record);
  if (legacyRows.length > 0 && legacy.cards.length === 0) {
    return { status: "error", message: PAL_ERROR_FALLBACK };
  }
  return { ...legacy, proposals: [] };
}

/**
 * Create a chat ask session with latest-wins ordering and in-thread memory.
 */
export function createPalChatSession(options: SessionOptions = {}) {
  const timeoutMs = options.timeoutMs ?? PAL_CHAT_TIMEOUT_MS;
  const fetchImpl = options.fetchImpl ?? fetch;
  let currentId = 0;
  const turns: AskTurn[] = [];

  return async function ask(
    query: string,
    cityId: string,
  ): Promise<PalChatResult | null> {
    const requestId = ++currentId;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
      let response: Response;
      let body: unknown;
      try {
        response = await fetchImpl("/api/ask", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            query,
            cityId,
            turns: turns.slice(-6),
          }),
          signal: controller.signal,
        });
        body = await response.json();
      } finally {
        clearTimeout(timeoutId);
      }
      if (requestId !== currentId) return null;
      if (!response.ok) {
        const record =
          body && typeof body === "object" && !Array.isArray(body)
            ? (body as Record<string, unknown>)
            : {};
        return {
          status: "error",
          message:
            typeof record.error === "string" ? record.error : PAL_ERROR_FALLBACK,
        };
      }
      const result = askBodyToPal(body);
      if (result.status !== "error") {
        turns.push({ role: "user", content: query });
        turns.push({ role: "assistant", content: result.message });
        while (turns.length > 6) turns.shift();
      }
      return result;
    } catch {
      if (requestId !== currentId) return null;
      return { status: "error", message: PAL_ERROR_FALLBACK };
    }
  };
}
