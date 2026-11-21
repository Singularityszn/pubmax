// Deterministic Ask routing and deferred conversation refinement.
// Client navigation reads the shared rules without loading this deferred module.

import { semanticAskRequest } from "@/lib/ask/requestPolicy";
import { defaultKnownAreas, deterministicAreaInText, extractExplicitBudget } from "@/lib/concierge/intentPolicy";
import { extractArea, requestedVenueCount, resolveAskPriceIntent, routeAskDeterministically, socialTurnKind } from "@/lib/ask/routingPolicy";
import { venueRequirementsInText } from "@/lib/concierge/requirements";
import { palPlaceInQuery } from "@/lib/palPlaces";

export { askRequestClauses } from "@/lib/ask/requestPolicy";
export {
  extractArea,
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
  const priorLocality = priorLines.map((line) => semanticAskRequest(line, false)).map((line) => {
    if (socialTurnKind(line)) return undefined;
    const prior = line.replace(SAME_AREA_REFERENCE_RE, "");
    const place = palPlaceInQuery(prior);
    if (place) return `near ${place.name}`;
    const area = deterministicAreaInText(prior, knownAreas);
    return area ? `in ${area}` : undefined;
  }).findLast(Boolean);
  return priorLocality ? query.replace(SAME_AREA_REFERENCE_RE, `pubs ${priorLocality}`) : null;
}

function isPlacelessRequirementAsk(text: string): boolean {
  if (extractArea(text)) return false;
  return requestedVenueCount(text) !== null
    || venueRequirementsInText(text).some((requirement) => requirement.kind !== "drink");
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
  if (!priorUserContent || words.length === 0) return query;
  const requirementFollowUp = words.length > 4 && isPlacelessRequirementAsk(text);
  if (words.length > 4 && !requirementFollowUp) return query;
  if (socialTurnKind(priorUserContent)) return query;
  if (extractArea(text) || palPlaceInQuery(text)) return query;
  const current = routeAskDeterministically(query);
  if (current.some((call) => call.name !== "search_venues")) return query;
  const prior = semanticAskRequest(priorUserContent, false);
  const place = palPlaceInQuery(prior);
  if (place) return `${query}${text === query ? "" : "."} near ${place.name}`;
  const priorArea = extractArea(prior);
  if (priorArea) return `${query}${text === query ? "" : "."} in ${priorArea}`;
  return requirementFollowUp ? query : `${priorUserContent}; ${query}`;
}
