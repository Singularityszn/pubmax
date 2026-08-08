// Deterministic Night OS Ask router (keyless path). Picks 1–2 allowlisted tools
// from the user query without calling a paid model.

import { detectWhatsOnIntent } from "@/lib/concierge/whatsOn";
import type { AskToolName } from "@/lib/ask/types";

export type RoutedToolCall = {
  name: AskToolName;
  args: Record<string, unknown>;
};

const CITY_STATUS_RE =
  /\b(tube|transit|delay|delays|weather|city status|how'?s london|right now in london)\b/i;
const JOURNEY_RE =
  /\b(how (do|can) i get|journey|get (me )?to|directions to|route to)\b/i;
const HERITAGE_RE =
  /\b(heritage|history|histor(?:y|ic)|listed building|when was|who built|story of|tell me about)\b/i;
const PRICE_RE =
  /\b(price|pint|how much|£|gbp|cost of a)\b/i;
const PLAN_RE =
  /\b(plan|crawl|three[- ]stop|3[- ]stop|sort (me )?a night|route for)\b/i;
const AREA_BUZZ_RE =
  /\b(buzz|what'?s (it )?like in|things to do in|average pint in)\b/i;
const OPEN_MAP_RE =
  /\b(open|show|fly to|take me to)\b/i;

function extractArea(query: string): string | null {
  const inMatch = query.match(/\bin\s+([A-Za-z][A-Za-z\s'-]{1,40})$/i);
  if (inMatch?.[1]) return inMatch[1].trim();
  const nearMatch = query.match(/\bnear\s+([A-Za-z][A-Za-z\s'-]{1,40})$/i);
  if (nearMatch?.[1]) return nearMatch[1].trim();
  return null;
}

function stripIntentWords(query: string): string {
  return query
    .replace(HERITAGE_RE, " ")
    .replace(PRICE_RE, " ")
    .replace(OPEN_MAP_RE, " ")
    .replace(JOURNEY_RE, " ")
    .replace(PLAN_RE, " ")
    .replace(/\b(the|a|an|pub|please|tonight|for)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Choose tools for a free-text ask. Order matters: specialised intents beat the
 * default venue search. Cap at two tools so the keyless path stays snappy.
 */
export function routeAskDeterministically(query: string): RoutedToolCall[] {
  const text = query.trim();
  if (!text) return [];

  const calls: RoutedToolCall[] = [];
  const push = (name: AskToolName, args: Record<string, unknown> = {}) => {
    if (calls.some((c) => c.name === name)) return;
    if (calls.length >= 2) return;
    calls.push({ name, args });
  };

  if (detectWhatsOnIntent(text)) {
    push("whats_on", { query: text });
    return calls;
  }

  if (CITY_STATUS_RE.test(text)) {
    push("city_status");
  }

  if (AREA_BUZZ_RE.test(text)) {
    const area = extractArea(text) ?? "Westminster";
    push("area_buzz", { area });
  }

  if (JOURNEY_RE.test(text)) {
    const to = stripIntentWords(text) || text;
    push("journey", { from: "London Bridge", to });
  }

  if (HERITAGE_RE.test(text)) {
    const venueName = stripIntentWords(text);
    push("venue_heritage", venueName ? { venueName, query: text } : { query: text });
  }

  if (PRICE_RE.test(text) && !PLAN_RE.test(text)) {
    const venueName = stripIntentWords(text);
    push("venue_prices", venueName ? { venueName, query: text } : { query: text });
  }

  if (PLAN_RE.test(text)) {
    push("propose_plan", { query: text });
  }

  if (OPEN_MAP_RE.test(text) && !PLAN_RE.test(text) && calls.length === 0) {
    const venueName = stripIntentWords(text);
    push("propose_map_action", venueName ? { venueName } : { query: text });
  }

  if (calls.length === 0) {
    push("search_venues", { query: text, limit: 4 });
  }

  return calls;
}
