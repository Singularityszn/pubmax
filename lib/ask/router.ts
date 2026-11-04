// Deterministic Ask routing and deferred conversation refinement.
// Client navigation reads the shared rules without loading this deferred module.

import { semanticAskRequest } from "@/lib/ask/requestPolicy";
import { defaultKnownAreas, deterministicAreaInText, extractExplicitBudget } from "@/lib/concierge/intentPolicy";
import { extractArea, resolveAskPriceIntent, routeAskDeterministically, socialTurnKind } from "@/lib/ask/routingPolicy";

export { askRequestClauses } from "@/lib/ask/requestPolicy";
export {
  isIndependentAskTool,
  isVenueDiscoveryAsk,
  isVenueHoursQuestion,
  namedMenuRequest,
  recordedDrinkComparison,
  resolveAskJourney,
  resolveAskPriceIntent,
  routeAskDeterministically,
  socialTurnKind,
  unsupportedPriceComparison,
} from "@/lib/ask/routingPolicy";
export type { RoutedToolCall, UnsupportedPriceComparison } from "@/lib/ask/routingPolicy";

/**
 * A short follow-up borrows the prior turn's PLACE only. A social prior turn
 * ("hi", "thanks") is not context, so a bare "Soho" after it stays "Soho". The current ask's
 * own claim wins, so a pint ask after a wifi ask cannot be swallowed by
 * find_desk matching the earlier sentence.
 */
const SAME_AREA_REFERENCE_RE = /(?:\b(?:in|near|around)\s+)?\b(?:the\s+)?same\s+(?:area|patch|neighbou?rhood)\b/i;

/** A pint-budget refinement keeps the discovered area without replacing a named subject. */
export function refineVenueBudgetFollowUp(query: string, priorUserContent: string | readonly string[] | null | undefined): string | null {
  const text = semanticAskRequest(query, false);
  if (!priorUserContent || !SAME_AREA_REFERENCE_RE.test(text)
    || extractExplicitBudget(text) === undefined || /\bat\s+\S/i.test(text)) return null;
  const price = resolveAskPriceIntent(text);
  if (price.kind !== "none" && price.kind !== "pint") return null;
  const knownAreas = defaultKnownAreas();
  if (deterministicAreaInText(text.replace(SAME_AREA_REFERENCE_RE, ""), knownAreas)) return null;
  const priorLines = typeof priorUserContent === "string" ? [priorUserContent] : priorUserContent;
  const priorArea = priorLines.map((line) => semanticAskRequest(line, false)).map((line) => socialTurnKind(line) ? undefined : deterministicAreaInText(line.replace(SAME_AREA_REFERENCE_RE, ""), knownAreas)).findLast(Boolean);
  return priorArea ? query.replace(SAME_AREA_REFERENCE_RE, `pubs in ${priorArea}`) : null;
}

export function refineRoutedAskQuery(
  query: string,
  priorUserContent: string | null | undefined,
  priorUserContents?: readonly string[],
): string {
  const budgetFollowUp = refineVenueBudgetFollowUp(query, priorUserContents ?? priorUserContent);
  if (budgetFollowUp) return budgetFollowUp;
  const text = semanticAskRequest(query, false);
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (!priorUserContent || words.length === 0 || words.length > 4) return query;
  if (socialTurnKind(priorUserContent)) return query;
  const current = routeAskDeterministically(query);
  if (current.some((call) => call.name !== "search_venues")) return query;
  const priorPlace = extractArea(semanticAskRequest(priorUserContent, false));
  if (priorPlace) return `${query}${text === query ? "" : "."} in ${priorPlace}`;
  return `${priorUserContent}; ${query}`;
}

