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
// Pub Pal V0.1 wave (R-015). Each intent is narrower than the generic price or
// venue ask above it, so each is tested before the ones it would otherwise
// fall into.
// "dearest" and "best value" are deliberately absent: this tool ranks
// cheapest-first and its headline says so, so a dearest ask belongs to the
// price tools below rather than being answered backwards.
const CHEAPEST_NEAR_RE = /\b(cheapest|cheap(?:est)? pint)\b/i;
// Every alternative names the LISTINGS question. A bare "right now" is a time
// qualifier a drinker hangs on any ask, so it is not one of them.
const TONIGHT_NOW_RE =
  /\b(on right now|on now|happening now|what'?s on now|busy right now|how busy)\b/i;
const VENUE_DRINKS_RE =
  /\b(what do they (?:pour|serve)|drinks? list|drink prices?|what'?s on tap|price of a (?:wine|cocktail|spirit))\b/i;
const FIND_DESK_RE =
  /\b(work from|sit and work|laptop|wi-?fi|desk|co-?working|somewhere to work|plug socket)\b/i;
// "it's quiet" is missing on purpose: quiet is how a drinker asks for a pub,
// so it stays with the venue search rather than becoming a reporting form.
const REPORT_OCCUPANCY_RE =
  /\b(it'?s (?:empty|full|rammed|packed|heaving)|report (?:the )?(?:crowd|occupancy)|no seats|some seats|log how busy)\b/i;

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
 * The venue phrase left in a V0.1 concierge ask.
 *
 * Separate from `stripIntentWords` on purpose: these intents carry their own
 * vocabulary plus the place prepositions ("near", "at", "round"), and widening
 * the shared stripper would change what the heritage, price and journey tools
 * are handed.
 */
function stripConciergeIntentWords(query: string): string {
  return stripIntentWords(query)
    .replace(CHEAPEST_NEAR_RE, " ")
    .replace(VENUE_DRINKS_RE, " ")
    .replace(FIND_DESK_RE, " ")
    .replace(REPORT_OCCUPANCY_RE, " ")
    .replace(/\b(near|in|at|round|by|here|it'?s)\b/gi, " ")
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

  // The V0.1 concierge intents are each NARROWER than the generic ask they
  // would otherwise fall into, so they are tested first and answer alone.
  if (REPORT_OCCUPANCY_RE.test(text)) {
    const venueName = stripConciergeIntentWords(text);
    push("report_occupancy", {
      level: text,
      ...(venueName ? { venueName } : {}),
    });
    return calls;
  }

  if (FIND_DESK_RE.test(text)) {
    const area = extractArea(text);
    push("find_desk", area ? { area } : {});
    return calls;
  }

  // "How busy" and "busy right now" still overlap a tube or weather ask, so
  // the city keeps those.
  if (TONIGHT_NOW_RE.test(text) && !CITY_STATUS_RE.test(text)) {
    const area = extractArea(text);
    push("tonight_now", area ? { area } : {});
    return calls;
  }

  if (VENUE_DRINKS_RE.test(text)) {
    const venueName = stripConciergeIntentWords(text);
    push("venue_drinks", venueName ? { venueName } : { query: text });
    return calls;
  }

  if (detectWhatsOnIntent(text)) {
    push("whats_on", { query: text });
    return calls;
  }

  // A cheap CRAWL is still a crawl, so the plan intent keeps it.
  if (CHEAPEST_NEAR_RE.test(text) && !PLAN_RE.test(text)) {
    const area = extractArea(text);
    const venueName = area ? "" : stripConciergeIntentWords(text);
    push(
      "cheapest_pint_near",
      area ? { area } : venueName ? { venueName } : {},
    );
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
