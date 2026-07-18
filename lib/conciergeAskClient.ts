// F3 concierge-as-map-home — pure client logic for asking the grounded
// concierge from the map. Extracted from components/map/MapConciergeAsk.tsx so
// the race guard, timeout, and error-curation are unit-testable in a node
// environment (no React). The component stays a thin presentation layer.
//
// Guarantees:
// - Latest-ask-wins: a session's stale response resolves to null so it can
//   never overwrite a newer answer.
// - Honest timeout: a hung request is aborted after `timeoutMs` and surfaces
//   the curated error copy rather than spinning forever.
// - No raw JS error text ever reaches the UI: only the route's own explicit
//   `body.error` (or our curated copy) is user-facing; network TypeErrors,
//   JSON SyntaxErrors, and AbortErrors all collapse to the curated fallback.

// A normalised, map-linkable answer card — from either concierge response shape
// (venue ranking or a What's-On listing). `venueId` empty means "not tappable".
export type AskCard = {
  key: string;
  venueId: string;
  title: string;
  place: string;
  note: string;
  price: number | null;
};

export type AskResult =
  | { status: "answered"; message: string; cards: AskCard[] }
  | { status: "error"; message: string };

export const ASK_FALLBACK_MESSAGE = "The landlord couldn't sort that one just now.";

// A hung request must end "Asking…" honestly rather than spin forever.
export const ASK_TIMEOUT_MS = 10_000;

type AskOptions = {
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

/**
 * Create an ask session with latest-wins ordering. Each call to the returned
 * function supersedes the previous: a superseded (stale) ask resolves to null,
 * which callers must treat as "do nothing". Never throws — every failure path
 * resolves to an error AskResult with curated copy.
 */
export function createAskSession(options: AskOptions = {}) {
  const timeoutMs = options.timeoutMs ?? ASK_TIMEOUT_MS;
  const fetchImpl = options.fetchImpl ?? fetch;
  let currentId = 0;

  return async function ask(query: string, cityId: string): Promise<AskResult | null> {
    const requestId = ++currentId;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
      let response: Response;
      let body: Record<string, unknown> | null;
      try {
        response = await fetchImpl("/api/concierge", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ query, cityId, limit: 4 }),
          signal: controller.signal,
        });
        // A non-JSON body throws here and falls through to curated copy.
        const parsed: unknown = await response.json();
        body =
          parsed && typeof parsed === "object" && !Array.isArray(parsed)
            ? (parsed as Record<string, unknown>)
            : null;
      } finally {
        clearTimeout(timeoutId);
      }
      if (requestId !== currentId) return null; // superseded by a newer ask
      if (!response.ok) {
        // Only the route's own explicit error copy is user-facing.
        return {
          status: "error",
          message: typeof body?.error === "string" ? body.error : ASK_FALLBACK_MESSAGE,
        };
      }
      return answerFromBody(body);
    } catch {
      if (requestId !== currentId) return null;
      return { status: "error", message: ASK_FALLBACK_MESSAGE };
    }
  };
}

/**
 * Normalise either concierge response shape into map-linkable cards. Both paths
 * stay grounded: venue ranking returns real venues with reasons; the What's-On
 * path returns verified listings with provenance. We never fabricate a message —
 * the route always supplies its own honest copy (including refusals).
 */
export function answerFromBody(body: unknown): AskResult {
  const record =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};

  // What's-On answer (grounded listings). Carries its own honest message.
  if (record.mode === "whats-on") {
    const listings = Array.isArray(record.listings) ? record.listings : [];
    const cards: AskCard[] = listings.map((raw, index) => {
      const item = (raw ?? {}) as Record<string, unknown>;
      return {
        key: str(item.id) || `wo-${index}`,
        venueId: str(item.venueId),
        title: str(item.title) || "Listing",
        place: str(item.venue),
        note: str(item.detail),
        price: num(item.priceGbp),
      };
    });
    return {
      status: "answered",
      message: str(record.message) || "Here's what I found.",
      cards,
    };
  }

  // Venue-ranking answer. `message` is only present on the degraded/empty path.
  const venues = Array.isArray(record.venues) ? record.venues : [];
  const cards: AskCard[] = venues.map((raw, index) => {
    const item = (raw ?? {}) as Record<string, unknown>;
    const reasons = Array.isArray(item.reasons)
      ? (item.reasons.filter((r) => typeof r === "string") as string[])
      : [];
    return {
      key: str(item.id) || `v-${index}`,
      venueId: str(item.id),
      title: str(item.name) || "Pub",
      place: str(item.area),
      note: reasons[0] ?? "",
      price: num(item.cheapestPrice),
    };
  });

  const message =
    str(record.message) ||
    (cards.length > 0
      ? `${cards.length} grounded ${cards.length === 1 ? "pick" : "picks"}. Tap to see it on the map.`
      : "No grounded matches for that. Try a nearby area or a broader mood.");

  return { status: "answered", message, cards };
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
