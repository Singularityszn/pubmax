// Deterministic Night OS Ask router (keyless path). Picks 1–2 allowlisted tools
// from the user query without calling a paid model.

import { detectWhatsOnIntent } from "@/lib/concierge/whatsOn";
import type { AskToolName } from "@/lib/ask/types";
import type { DrinkCategory } from "@/lib/drinks";
import { isKnownAskPlacePhrase } from "@/lib/ask/placePhrases";
import { palAsksForVenueDiscovery } from "@/lib/palMapAsk";
import { defaultKnownAreas, deterministicAreaInText, extractExplicitBudget } from "@/lib/concierge/intentPolicy";

export type RoutedToolCall = {
  name: AskToolName;
  args: Record<string, unknown>;
};

export function isVenueHoursQuestion(query: string): boolean {
  const subjectQuery = stripTrailingPunctuation(query).replace(
    /\b(?:a|an|the)\s+(?:(?!(?:pub|bar|venue|place)\b)[^\s,.!?;]+\s+)*(?:pub|bar|venue|place)\s+(?:called|named)\s+/gi, "",
  );
  return /\b(?:opening|closing)\s+(?:hours|times)\b/i.test(query)
    && !PLAN_RE.test(query) && !isVenueDiscoveryAsk(subjectQuery)
    && requestedVenueCount(subjectQuery) === null
    && !/\b(?:a|an|any|some)\s+(?:[^\s,.!?;]+\s+)*?(?:pub|bar|venue|place)\b/i.test(subjectQuery);
}

const CITY_STATUS_RE =
  /\b(tube|transit|delay|delays|weather|city status|how'?s london|right now in london)\b/i;
const TRANSIT_INTERROGATIVE_PREFIX = String.raw`(?:is|are)\s+(?:there\s+)?(?:(?:any|the)\s+)?(?:tube|transit)\s+(?:(?:services?|lines?|trains?)\s+)?(?:running|operating|working|open|closed|delays?|delayed|disruptions?|disrupted|suspended)\b`;
const TRANSIT_INTERROGATIVE_RE = new RegExp(`^${TRANSIT_INTERROGATIVE_PREFIX}`, "i");
const JOURNEY_RE =
  /\b(how (do|can) i get|journey|get (me )?to|directions to|route to)\b/i;
const HERITAGE_RE =
  /\b(heritage|history|histor(?:y|ic)|listed building|when was|who built|story of|tell me about)\b/i;
const VENUE_DISCOVERY_RE = /\b(?:somewhere|anywhere|a place|a (?:date[- ]night )?pub)\b/i;
const PRICE_RE =
  /\b(prices?|pint|how much|£|gbp|costs?)\b/i;
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
// A cheapest ask is about an AREA or about what is AROUND a pub. "at The Lamb"
// names one pub as the subject, which is the price tool's question, so the
// cheapest branch only claims an ask that carries one of these.
const NEAR_ANCHOR_RE = /\b(near|nearby|nearest|around|round|close to|closest to)\b/i;
// Every alternative names the LISTINGS question. A bare "right now" is a time
// qualifier a drinker hangs on any ask, so it is not one of them.
const TONIGHT_NOW_RE =
  /\b(on right now|on now|happening now|what'?s on now|busy right now|how busy)\b/i;
const VENUE_DRINKS_RE =
  /\b(what do they (?:pour|serve)|drinks? list|drink prices?|what'?s on tap|price of a (?:wine|cocktail|spirit))\b/i;
const PRICE_COMPARISON_RE = /\b(cheapest|cheap|best value|lowest price|most affordable)\b/i;
const ITEM_PRICE_RE = /\b(?:how much(?:\s+(?:is|are|does|for))?|prices?(?:\s+(?:of|for))?|costs?(?:\s+(?:of|for))?)\b/i;
const FOOD_RE = /\b(food|meals?|lunch|dinner|breakfast|burgers?|pizza|sandwich(?:es)?|restaurants?)\b/i;
const NON_PINT_DRINK_RE = /\b(?:wine|cocktails?|spirits?|coffee|whisk(?:y|ey)|gin|rum|vodka|shots?|soft drinks?|alcohol[- ]free|non[- ]alcoholic)\b/i;
const RECORDED_DRINK_COMPARISON_SUBJECT_RE = new RegExp(`^(?:(?:listed|recorded|decent|good|local)\\s+)*${NON_PINT_DRINK_RE.source}$`, "i");
const PINT_COMPARISON_SUBJECT_RE = /^(?:(?:listed|recorded|decent|good|good[- ]value|local|nearby)\s+)*(?:pints?|beer)(?:\s+(?:and|with)\s+food)?$/i;
const VENUE_COMPARISON_MODIFIERS = "(?:quiet(?:-ish)?|calm|low-key|lively|buzzing|cosy|cozy|snug|fireside|garden|outdoor|riverside|waterside|sports|romantic|historic)";
const IMPLICIT_PUB_COMPARISON_SUBJECT_RE = new RegExp(`^(?:and\\s+)?(?:${VENUE_COMPARISON_MODIFIERS}(?:\\s+(?:and\\s+)?${VENUE_COMPARISON_MODIFIERS})*)?$`, "i");
const PUB_DISCOVERY_CONSTRAINT_RE = new RegExp(`\\b${VENUE_COMPARISON_MODIFIERS}\\b`, "i");
const PUB_COMPARISON_SUBJECT_RE = new RegExp(`^(?:(?:listed|recorded|local|nearby|${VENUE_COMPARISON_MODIFIERS})\\s+)*pubs?(?:\\s+(?:with|serving|that serves?)\\s+(?:food|(?:a\\s+)?(?:beer\\s+)?garden|(?:live\\s+)?sports))?$`, "i");
const PLAN_COMPARISON_SUBJECT = `(?:(?:3|three)[- ]stop\\s+)?(?:${VENUE_COMPARISON_MODIFIERS}\\s+)*(?:pub\\s+)?(?:crawl|night|route)`;
const PLAN_COMPARISON_SUBJECT_RE = new RegExp(`^${PLAN_COMPARISON_SUBJECT}$`, "i");
const PLAN_COMPARISON_TAIL_RE = new RegExp(`\\s+(?:and|with)\\s+(?:a\\s+)?${PLAN_COMPARISON_SUBJECT}$`, "i");
const RECORDED_PRICE_CATEGORIES: ReadonlyArray<readonly [RegExp, DrinkCategory]> = [
  [/^wine$/i, "wine"],
  [/^cocktails?$/i, "cocktail"],
  [/^coffee$/i, "coffee"],
  [/^whisk(?:y|ey)$/i, "whisky"],
  [/^gin$/i, "gin"],
  [/^rum$/i, "rum"],
  [/^vodka$/i, "vodka"],
  [/^shots?$/i, "shot"],
  [/^soft drinks?$/i, "soft-drink"],
  [/^(?:alcohol[- ]free|non[- ]alcoholic)$/i, "alcohol-free"],
];

export type UnsupportedPriceComparison = {
  code: "UNSUPPORTED_FOOD_PRICE_COMPARISON" | "UNSUPPORTED_DRINK_PRICE_COMPARISON" | "UNSUPPORTED_PRICE_COMPARISON";
  answer: string;
};

type AskPriceIntent =
  | { kind: "none" | "plan" | "drink-venues" }
  | { kind: "menu"; venueName: string }
  | { kind: "pub-price"; venueName: string | null }
  | { kind: "pint"; venueName: string | null; foodAvailability: boolean }
  | { kind: "recorded-drinks"; venueName: string; category?: DrinkCategory }
  | { kind: "unsupported"; coverage: UnsupportedPriceComparison };

function namedDrinkVenue(query: string): string | null {
  const match = stripTrailingQualifiers(stripTrailingPunctuation(query))
    .replace(/\s+costs?$/i, "")
    .match(/\bat\s+([A-Za-z][A-Za-z\s&,'’-]{1,100})$/i);
  if (!match?.[1] || PRICE_COMPARISON_RE.test(match[1]) || ITEM_PRICE_RE.test(match[1])) return null;
  return stripTrailingQualifiers(match[1])
    .split(/\s+(?:with|for)\s+/i)[0]!
    .replace(/\s+(?:near|close to|by)\s+(?:the\s+)?(?:tube|(?:[A-Za-z&'’-]+\s+)*station)$/i, "")
    .trim() || null;
}

function askRequestClauses(query: string): string[] {
  const pricePrefix = String.raw`(?:${NON_PINT_DRINK_RE.source}|pints?|beer|drinks?)\s+${ITEM_PRICE_RE.source}`;
  return query.split(new RegExp(String.raw`(?:\s+and\s+|,\s*)(?=(?:any\s+)?(?:${TRANSIT_INTERROGATIVE_PREFIX}|${pricePrefix}|${ITEM_PRICE_RE.source}|how\b|what\b|where\b|find\b|show\b|plan\b|directions to\b|route to\b|get (?:me )?to\b|tube delays?\b|transit delays?\b|weather\b|city status\b|cheap(?:est)?\b|best value\b|lowest price\b|most affordable\b))`, "i"));
}

function isCityStatusRequest(query: string): boolean {
  return CITY_STATUS_RE.test(query) && (TRANSIT_INTERROGATIVE_RE.test(query.trim()) || /^(?:any\s+)?(?:tube|transit|delays?|weather|city status)\b|^how(?:'s| is| are)\s+(?:the\s+)?(?:tube|transit|weather|london)\b|^(?:what|check|tell me)\b.*\b(?:delays?|weather|city status)\b|^right now in london\b/i.test(query.trim()));
}

export function resolveAskJourney(query: string): { from?: string; to: string } | null {
  const clause = askRequestClauses(query).find((part) => JOURNEY_RE.test(part));
  if (!clause) return null;
  const match = clause.match(JOURNEY_RE)!;
  const endpoints = stripTrailingQualifiers(stripTrailingPunctuation(
    clause.slice((match.index ?? 0) + match[0].length).replace(/^\s*to\s+/i, "").trim(),
  ));
  const originFirst = endpoints.match(/^from\s+(.+?)\s+to\s+(.+)$/i);
  if (originFirst) return { from: originFirst[1]!.trim(), to: originFirst[2]!.trim() };
  const originLast = endpoints.match(/^(.+?)\s+from\s+(.+)$/i);
  if (originLast) return { from: originLast[2]!.trim(), to: originLast[1]!.trim() };
  return { to: endpoints };
}

function priceQuestion(query: string): string {
  const clauses = askRequestClauses(query).map((clause) =>
    stripTrailingQualifiers(stripTrailingPunctuation(clause)),
  );
  const priceClauses = clauses.filter((clause) =>
    !socialTurnKind(clause) && !((isCityStatusRequest(clause) || JOURNEY_RE.test(clause))
      && !ITEM_PRICE_RE.test(clause) && !PRICE_COMPARISON_RE.test(clause)),
  );
  return priceClauses.join(" and ");
}

export function namedMenuRequest(query: string): { venueName: string; subject: string } | null {
  const question = priceQuestion(query);
  const venueName = namedDrinkVenue(question);
  if (!venueName || PRICE_COMPARISON_RE.test(question)) return null;
  const subject = question.slice(0, question.search(/\bat\s+/i)).trim();
  if (!/\b(?:prices?|costs?|how much|menu|food|meals?|calories|calorie|kcal|dietary|vegan|vegetarian|gluten[- ]free|servings?)\b/i.test(subject)) return null;
  const priceSubject = priceComparisonSubject(question);
  if (priceSubject !== null && (PINT_COMPARISON_SUBJECT_RE.test(priceSubject) || PUB_COMPARISON_SUBJECT_RE.test(priceSubject) || !priceSubject)) return null;
  return { venueName, subject };
}

function priceComparisonSubject(query: string): string | null {
  const venueName = namedDrinkVenue(query);
  if (venueName && !PRICE_COMPARISON_RE.test(venueName) && !ITEM_PRICE_RE.test(venueName)) {
    const at = query.match(/\bat\s+/i)!;
    const start = at.index ?? 0;
    query = `${query.slice(0, start)} ${query.slice(start + at[0].length + venueName.length)}`;
  }
  const comparative = query.match(PRICE_COMPARISON_RE);
  const itemPrice = query.match(ITEM_PRICE_RE);
  const comparison = itemPrice ?? comparative;
  if (!comparison) return null;
  const normalizeSubject = (subject: string): string => stripTrailingQualifiers(
    stripTrailingPunctuation(subject).replace(/\s+costs?$/i, ""),
  ).replace(/^(?:a|an|the)(?:\s+|$)/i, "");
  let precedingItem = !/^how much/i.test(comparison[0])
    ? query.slice(0, comparison.index)
      .replace(/^(?:what(?:'s|\s+(?:is|are|does|do)\b)|can you tell me|tell me|(?:please\s+)?(?:help me\s+)?(?:find(?: me| us)?|show me|get(?: me| us)?))\s*/i, "")
    : "";
  if (!itemPrice) {
    precedingItem = precedingItem.replace(new RegExp(`^(?:plan|sort(?: me)?)\\s+(?:a\\s+)?(?:big\\s+)?${PLAN_COMPARISON_SUBJECT}(?:\\s+for\\s+(?:two|three|four|five|six|a few|\\d+)(?:\\s+of us)?)?\\s*,?(?:\\s*(?:with|and))?\\s*$`, "i"), "");
    precedingItem = precedingItem
      .replace(/^(?:somewhere|anywhere|a place)\b/i, "")
      .replace(/^(?:plan(?: me)?|sort(?: me)?)(?:\s+(?:3|three))?(?:\s+(?:a|an|the))?\s*$/i, "");
  }
  const afterPrice = query.slice((comparison.index ?? 0) + comparison[0].length).trim()
    .replace(/\bfor\s+(?:two|three|four|five|six|a few|\d+)(?:\s+(?:of us|people))?(?=\s+(?:in|near|at|around|with|tonight)\b|[?.!]*$)/gi, "")
    .replace(/\bfor a quick one after work[?.!]*$/i, "");
  const subjects = [precedingItem, afterPrice].flatMap((part) => part.split(/\bfor\b|,/i)).map((part) => {
    const subject = part.replace(/(?:^|\s+)(?:in|near|nearby|at|around|round|close to)\b([^,]*?)(?=\s+(?:for|with)\b|,|$)/gi, (_location, place: string) => {
      if (isKnownAskPlacePhrase(place)) return " ";
      const conjunction = place.search(/\s+and\b/i);
      return conjunction < 0 ? " " : place.slice(conjunction);
    }).trim();
    return normalizeSubject(subject.replace(/^(?:and|with)\s+/i, ""))
      .replace(PRICE_COMPARISON_RE, "").trim();
  });
  return subjects.filter(Boolean).join(" ");
}

/** One semantic price decision, shared by free-text and raw model-tool boundaries. */
export function resolveAskPriceIntent(query: string): AskPriceIntent {
  query = priceQuestion(query);
  const subject = priceComparisonSubject(query);
  const menu = namedMenuRequest(query);
  const bareCategory = subject && RECORDED_PRICE_CATEGORIES.find(([pattern]) => pattern.test(subject));
  if (menu && !bareCategory && !/^drinks?$/i.test(subject ?? "")) return { kind: "menu", venueName: menu.venueName };
  if (subject === null) return { kind: "none" };
  const comparative = PRICE_COMPARISON_RE.test(query);
  const venueName = namedDrinkVenue(query);
  if (!subject && !comparative) return { kind: "pub-price", venueName };
  if (comparative && IMPLICIT_PUB_COMPARISON_SUBJECT_RE.test(subject)) {
    const prefix = query.slice(0, query.search(PRICE_COMPARISON_RE)).trim();
    if (/^(?:(?:find(?: me| us)?|show me)\s+)?(?:somewhere|anywhere|a place)$|^$/i.test(prefix)) {
      return { kind: "none" };
    }
  }
  const priceSubject = comparative && PLAN_RE.test(query)
    ? subject.replace(PLAN_COMPARISON_TAIL_RE, "") : subject;
  const food = FOOD_RE.test(priceSubject);
  if ((PINT_COMPARISON_SUBJECT_RE.test(priceSubject) || PUB_COMPARISON_SUBJECT_RE.test(priceSubject)) && (!food || comparative)) {
    return PLAN_RE.test(query) ? { kind: "plan" } : { kind: "pint", venueName, foodAvailability: food };
  }
  if (PLAN_RE.test(query) && PLAN_COMPARISON_SUBJECT_RE.test(subject)) return { kind: "plan" };
  if (FOOD_RE.test(subject)) {
    return {
      kind: "unsupported",
      coverage: {
        code: "UNSUPPORTED_FOOD_PRICE_COMPARISON",
        answer: "I can't compare meal prices or check dietary options yet. I can help you find pubs with food.",
      },
    };
  }
  const categorySubject = subject.replace(/^(?:(?:listed|recorded|decent|good|local)\s+)+/i, "");
  const category = RECORDED_DRINK_COMPARISON_SUBJECT_RE.test(subject)
    ? RECORDED_PRICE_CATEGORIES.find(([pattern]) => pattern.test(categorySubject))?.[1]
    : undefined;
  if (/^drinks?$/i.test(categorySubject)) {
    return venueName ? { kind: "recorded-drinks", venueName } : { kind: "drink-venues" };
  }
  if (category && venueName) return { kind: "recorded-drinks", venueName, category };
  if (NON_PINT_DRINK_RE.test(subject)) {
    return {
      kind: "unsupported",
      coverage: {
        code: "UNSUPPORTED_DRINK_PRICE_COMPARISON",
        answer: venueName
          ? "I can't verify a price for that drink or serving yet. Ask about a recorded drink category at this pub."
          : "I can compare listed pint prices, but not other drinks across pubs yet. Name a pub and I'll check its recorded drinks.",
      },
    };
  }
  return {
    kind: "unsupported",
    coverage: {
      code: "UNSUPPORTED_PRICE_COMPARISON",
      answer: "I can compare listed pint prices, but not prices for that item yet. Ask about pints or name a pub to check its recorded drinks.",
    },
  };
}

export function isVenueDiscoveryAsk(query: string): boolean {
  if (VENUE_DISCOVERY_RE.test(query) || palAsksForVenueDiscovery(query)) return true;
  const priceQuery = priceQuestion(query);
  const intent = resolveAskPriceIntent(priceQuery);
  return PRICE_COMPARISON_RE.test(priceQuery)
    && (intent.kind === "none" || (intent.kind === "pint" && !intent.venueName
      && (extractArea(priceQuery) !== null || !/^(?:pints?|beer|pubs?)$/i.test(priceComparisonSubject(priceQuery) ?? ""))));
}

export function isIndependentAskTool(name: string): boolean {
  return name === "city_status" || name === "journey";
}

export function unsupportedPriceComparison(query: string): UnsupportedPriceComparison | null {
  const intent = resolveAskPriceIntent(query);
  return intent.kind === "unsupported" ? intent.coverage : null;
}

/** One pub's recorded drinks remain available even though cross-pub comparisons do not. */
export function recordedDrinkComparison(query: string): RoutedToolCall | null {
  const intent = resolveAskPriceIntent(query);
  return intent.kind === "menu"
    ? { name: "venue_drinks", args: { venueName: intent.venueName } }
    : intent.kind === "recorded-drinks"
    ? { name: "venue_drinks", args: { venueName: intent.venueName, ...(intent.category ? { drinkCategory: intent.category } : {}) } }
    : null;
}
const FIND_DESK_RE =
  /\b(work from|sit and work|laptop|wi-?fi|desk|co-?working|somewhere to work|plug socket)\b/i;
// "it's quiet" is missing on purpose: quiet is how a drinker asks for a pub,
// so it stays with the venue search rather than becoming a reporting form.
const REPORT_OCCUPANCY_RE =
  /\b(it'?s (?:empty|full|rammed|packed|heaving)|report (?:the )?(?:crowd|occupancy)|no seats|some seats|log how busy)\b/i;

/**
 * Time and group words a drinker hangs on the end of an ask. They are not
 * part of a place name, so a `$` capture that keeps "Camden tonight" cannot
 * place Camden at all.
 */
const TRAILING_QUALIFIER_RE =
  /(?:^|\s+)(?:tonight|right now|now|later|today|this evening|this afternoon|this morning|this weekend|with mates|for (?:two|a few|\d+))\s*$/i;

function stripTrailingPunctuation(phrase: string): string {
  return phrase.replace(/[?.!,;:]+$/g, "").trim();
}

function stripTrailingQualifiers(phrase: string): string {
  let current = phrase.trim();
  for (;;) {
    const next = current.replace(TRAILING_QUALIFIER_RE, "").trim();
    if (next === current) return current;
    current = next;
  }
}

/** "in X" at the end of an ask: a PLACE, never a pub. */
function extractInPlace(query: string): string | null {
  const match = stripTrailingPunctuation(query).match(/\bin\s+([A-Za-z][A-Za-z\s'-]{1,40})$/i);
  const place = match?.[1] ? stripTrailingPunctuation(stripTrailingQualifiers(match[1])) : "";
  return place || null;
}

/**
 * "near X" at the end of an ask: a CENTRE, which may be a pub or an area.
 *
 * The two are kept apart because the tools read them differently: an area word
 * the pack cannot place answers nothing rather than landing on a pub that
 * happens to share the name.
 */
function extractNearAnchorName(query: string): string | null {
  const match = stripTrailingPunctuation(query).match(
    /\b(?:near|nearby|around|round|close to|closest to)\s+([A-Za-z][A-Za-z\s'-]{1,40})$/i,
  );
  const place = match?.[1] ? stripTrailingPunctuation(stripTrailingQualifiers(match[1])) : "";
  return place || null;
}

function extractArea(query: string): string | null {
  return extractInPlace(query) ?? extractNearAnchorName(query);
}

/**
 * A social turn is only a greeting or thanks, with at most a form of address
 * after it. Anything that also asks for something is not one.
 */
export function socialTurnKind(query: string): "greeting" | "thanks" | null {
  if (
    /^(?:hi|hello|hey|hiya|heya|yo|howdy|evening|good (?:morning|afternoon|evening))(?:[\s,]+(?:there|pal|pub pal|mate|all|everyone))?[.!?\s]*$/i.test(
      query,
    )
  ) {
    return "greeting";
  }
  if (
    /^(?:thanks|thank you|thx|ty|ta|cheers|many thanks)(?:\s+(?:so much|a lot|very much|loads))?(?:[\s,]+(?:pal|pub pal|mate))?[.!?\s]*$/i.test(
      query,
    )
  ) {
    return "thanks";
  }
  return null;
}

/**
 * A short follow-up borrows the prior turn's PLACE only. A social prior turn
 * ("hi", "thanks") is not context, so a bare "Soho" after it stays "Soho". The current ask's
 * own claim wins, so a pint ask after a wifi ask cannot be swallowed by
 * find_desk matching the earlier sentence.
 */
const SAME_AREA_REFERENCE_RE = /(?:\b(?:in|near|around)\s+)?\b(?:the\s+)?same\s+(?:area|patch|neighbou?rhood)\b/i;

/** A pint-budget refinement keeps the discovered area without replacing a named subject. */
export function refineVenueBudgetFollowUp(query: string, priorUserContent: string | readonly string[] | null | undefined): string | null {
  if (!priorUserContent || !SAME_AREA_REFERENCE_RE.test(query)
    || extractExplicitBudget(query) === undefined || /\bat\s+\S/i.test(query)) return null;
  const price = resolveAskPriceIntent(query);
  if (price.kind !== "none" && price.kind !== "pint") return null;
  const knownAreas = defaultKnownAreas();
  if (deterministicAreaInText(query.replace(SAME_AREA_REFERENCE_RE, ""), knownAreas)) return null;
  const priorLines = typeof priorUserContent === "string" ? [priorUserContent] : priorUserContent;
  const priorArea = priorLines.map((line) => socialTurnKind(line) ? undefined : deterministicAreaInText(line.replace(SAME_AREA_REFERENCE_RE, ""), knownAreas)).findLast(Boolean);
  return priorArea ? query.replace(SAME_AREA_REFERENCE_RE, `pubs in ${priorArea}`) : null;
}

export function refineRoutedAskQuery(
  query: string,
  priorUserContent: string | null | undefined,
  priorUserContents?: readonly string[],
): string {
  const budgetFollowUp = refineVenueBudgetFollowUp(query, priorUserContents ?? priorUserContent);
  if (budgetFollowUp) return budgetFollowUp;
  const words = query.trim().split(/\s+/).filter(Boolean);
  if (!priorUserContent || words.length === 0 || words.length > 4) return query;
  if (socialTurnKind(priorUserContent)) return query;
  const current = routeAskDeterministically(query);
  if (current.some((call) => call.name !== "search_venues")) return query;
  const priorPlace = extractArea(priorUserContent);
  if (priorPlace) return `${query} in ${priorPlace}`;
  return `${priorUserContent} - ${query}`;
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
 * A V0.1 concierge tool claiming one ask, or null when it may not.
 *
 * TWO rules govern every entry below, and they are what stop a new trigger
 * quietly taking an ask off a shipped tool.
 *
 *   1. A tool claims only when its OWN precondition holds. cheapest_pint_near
 *      needs an area or a near-style anchor; venue_drinks needs ONE named pub,
 *      never a place phrase; tonight_now is a now-question with no kind in it.
 *      A tool that cannot resolve what it needs falls through rather than
 *      answering with a guess.
 *   2. Where a more specific shipped intent matches the same words, the shipped
 *      tool keeps the ask. A named What's-On KIND is that intent: whats_on
 *      filters by it and no V0.1 tool does.
 */
type ConciergeClaim = { name: AskToolName; args: Record<string, unknown> };

function reportOccupancyClaim(text: string): ConciergeClaim | null {
  if (!REPORT_OCCUPANCY_RE.test(text)) return null;
  const venueName = stripConciergeIntentWords(text);
  return {
    name: "report_occupancy",
    args: { level: text, ...(venueName ? { venueName } : {}) },
  };
}

function findDeskClaim(text: string): ConciergeClaim | null {
  if (!FIND_DESK_RE.test(text)) return null;
  // A pub or pint ask that happens to mention wifi is still a pub ask.
  if (PRICE_RE.test(text) || CHEAPEST_NEAR_RE.test(text) || /\bpubs?\b/i.test(text)) {
    return null;
  }
  const area = extractArea(text);
  return { name: "find_desk", args: area ? { area } : {} };
}

function tonightNowClaim(
  text: string,
  whatsOnKind: string | undefined,
): ConciergeClaim | null {
  if (!TONIGHT_NOW_RE.test(text)) return null;
  // "How busy" and "busy right now" still overlap a tube or weather ask, so
  // the city keeps those; a named kind belongs to whats_on.
  if (CITY_STATUS_RE.test(text) || whatsOnKind) return null;
  const area = extractArea(text);
  return { name: "tonight_now", args: area ? { area } : {} };
}

function venueDrinksClaim(text: string): ConciergeClaim | null {
  const comparison = recordedDrinkComparison(text);
  if (comparison) return comparison;
  if (!VENUE_DRINKS_RE.test(text)) return null;
  // "drink prices in Camden" names a PLACE. This tool reads one pub, so a
  // place phrase leaves it to the tools that answer about an area.
  if (extractArea(text)) return null;
  const venueName = stripConciergeIntentWords(text);
  if (!venueName) return null;
  return { name: "venue_drinks", args: { venueName } };
}

function cheapestNearClaim(text: string): ConciergeClaim | null {
  text = priceQuestion(text);
  if (!CHEAPEST_NEAR_RE.test(text) || PLAN_RE.test(text)) return null;
  const subject = priceComparisonSubject(text) ?? "";
  if (PUB_COMPARISON_SUBJECT_RE.test(subject) && PUB_DISCOVERY_CONSTRAINT_RE.test(subject)) return null;
  // "in Camden" is a place and only a place. "near The Lamb" is a centre, so it
  // rides the anchor slot, where a named pub still resolves.
  const place = extractInPlace(text);
  if (place) return { name: "cheapest_pint_near", args: { area: place } };
  const anchorName = extractNearAnchorName(text);
  if (anchorName) {
    return { name: "cheapest_pint_near", args: { venueName: anchorName } };
  }
  if (!NEAR_ANCHOR_RE.test(text)) return null;
  const venueName = stripConciergeIntentWords(text);
  return {
    name: "cheapest_pint_near",
    args: venueName ? { venueName } : {},
  };
}

function conciergeClaim(
  text: string,
  whatsOn: ReturnType<typeof detectWhatsOnIntent>,
): ConciergeClaim | null {
  return (
    reportOccupancyClaim(text) ??
    findDeskClaim(text) ??
    tonightNowClaim(text, whatsOn?.kind) ??
    venueDrinksClaim(text) ??
    (whatsOn ? null : cheapestNearClaim(text))
  );
}

function requestedVenueCount(query: string): number | null {
  const count = query.match(/\b(1|2|3|4|5|6|one|two|three|four|five|six)\s+(?:(?:good|quiet|lively|cosy|cozy|cheap|historic|local|nearby|listed|great|best)\s+)*(?:pubs?|bars?|venues?|places?)\b/i)?.[1]?.toLowerCase();
  const words: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
  return count ? words[count] ?? Number(count) : null;
}

/**
 * Choose tools for a free-text ask. Order matters: specialised intents beat the
 * default venue search. Cap at two tools so the keyless path stays snappy.
 */
export function routeAskDeterministically(query: string): RoutedToolCall[] {
  const text = query.trim();
  if (!text) return [];
  const priceIntent = resolveAskPriceIntent(text);

  const calls: RoutedToolCall[] = [];
  const push = (name: AskToolName, args: Record<string, unknown> = {}) => {
    if (calls.some((c) => c.name === name)) return;
    if (calls.length >= 2) return;
    calls.push({ name, args });
  };

  const clauses = askRequestClauses(text);
  if (clauses.some(isCityStatusRequest)) {
    push("city_status");
  }

  const journey = resolveAskJourney(text);
  if (journey) push("journey", { from: "London Bridge", ...journey });

  if (priceIntent.kind === "unsupported") return calls;
  if (isVenueHoursQuestion(text)) {
    push("search_venues", { query: text });
    return calls;
  }
  if (priceIntent.kind === "menu") {
    push("venue_drinks", { venueName: priceIntent.venueName });
    return calls;
  }

  if (AREA_BUZZ_RE.test(text)) {
    const area = extractArea(text) ?? "Westminster";
    push("area_buzz", { area });
  }

  if (HERITAGE_RE.test(text) && !isVenueDiscoveryAsk(text)) {
    const venueName = stripIntentWords(text);
    push("venue_heritage", venueName ? { venueName, query: text } : { query: text });
  }

  if (priceIntent.kind === "drink-venues") {
    push("search_venues", { query: text, limit: requestedVenueCount(text) ?? 4 });
    return calls;
  }

  const whatsOn = detectWhatsOnIntent(text);
  const claim = conciergeClaim(text, whatsOn);
  if (claim) {
    push(claim.name, claim.args);
    return calls;
  }

  if (whatsOn) {
    push("whats_on", { query: text });
    return calls;
  }

  if (PRICE_RE.test(text) && !PLAN_RE.test(text) && !isVenueDiscoveryAsk(text)) {
    const venueName = priceIntent.kind === "pint" || priceIntent.kind === "pub-price"
      ? priceIntent.venueName ?? stripIntentWords(text) : stripIntentWords(text);
    push("venue_prices", venueName ? { venueName, query: text } : { query: text });
  }

  if (PLAN_RE.test(text)) {
    push("propose_plan", { query: text });
  }

  if (OPEN_MAP_RE.test(text) && !PLAN_RE.test(text) && !isVenueDiscoveryAsk(text) && !palAsksForVenueDiscovery(text) && calls.length === 0) {
    const venueName = stripIntentWords(text);
    push("propose_map_action", venueName ? { venueName } : { query: text });
  }

  if (calls.length === 0) {
    push("search_venues", { query: text, limit: requestedVenueCount(text) ?? 4 });
  }

  return calls;
}
