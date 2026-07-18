// Pub Pal chat — client ask session over the EXISTING /api/concierge route.
// Extracted from the React component so the race guard, timeout, and error
// curation are unit-testable in a node environment (no DOM). The component is a
// thin presentation layer over this.
//
// Guarantees (mirrors lib/conciergeAskClient, the map's prior art):
// - Latest-ask-wins: a stale response resolves to null so it can never
//   overwrite a newer answer.
// - Honest timeout: a hung request is aborted after `timeoutMs` and surfaces the
//   curated house-voice fallback rather than spinning forever.
// - No raw JS error text ever reaches the UI: only the route's own explicit
//   `body.error` (or our curated copy) is user-facing.
//
// Statelessness (PRD Lane C: multi-turn memory OUT): every ask sends ONLY the
// current query. No prior turn is ever forwarded, so the engine has no
// conversational memory; the on-screen transcript is ephemeral client display,
// never persisted and never sent back. And no `narrated` flag is ever sent, so
// the paid model-narration seam stays OFF — deterministic answers only.

import {
  PAL_ERROR_FALLBACK,
  palAnswerFromBody,
  type PalAnswer,
} from "@/lib/palChat";

export type PalChatResult =
  | PalAnswer
  | { status: "error"; message: string };

// A hung request must end the "Asking" state honestly rather than spin forever.
export const PAL_CHAT_TIMEOUT_MS = 10_000;

type SessionOptions = {
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

/**
 * Create a chat ask session with latest-wins ordering. Each call to the returned
 * function supersedes the previous: a superseded (stale) ask resolves to null,
 * which callers must treat as "do nothing". Never throws — every failure path
 * resolves to an error result carrying curated house-voice copy.
 */
export function createPalChatSession(options: SessionOptions = {}) {
  const timeoutMs = options.timeoutMs ?? PAL_CHAT_TIMEOUT_MS;
  const fetchImpl = options.fetchImpl ?? fetch;
  let currentId = 0;

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
        response = await fetchImpl("/api/concierge", {
          method: "POST",
          headers: { "content-type": "application/json" },
          // Only the current query is sent: no prior turns (engine stays
          // stateless), no `narrated` flag (paid narration seam stays OFF).
          body: JSON.stringify({ query, cityId, limit: 4 }),
          signal: controller.signal,
        });
        // A non-JSON body throws here and falls through to curated copy.
        body = await response.json();
      } finally {
        clearTimeout(timeoutId);
      }
      if (requestId !== currentId) return null; // superseded by a newer ask
      if (!response.ok) {
        const record =
          body && typeof body === "object" && !Array.isArray(body)
            ? (body as Record<string, unknown>)
            : {};
        // Only the route's own explicit error copy is user-facing.
        return {
          status: "error",
          message:
            typeof record.error === "string" ? record.error : PAL_ERROR_FALLBACK,
        };
      }
      return palAnswerFromBody(body);
    } catch {
      if (requestId !== currentId) return null;
      return { status: "error", message: PAL_ERROR_FALLBACK };
    }
  };
}
