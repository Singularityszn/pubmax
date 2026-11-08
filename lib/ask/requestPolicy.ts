export const TRANSIT_INTERROGATIVE_PREFIX = String.raw`(?:is|are)\s+(?:there\s+)?(?:(?:any|the)\s+)?(?:tube|transit)\s+(?:(?:services?|lines?|trains?)\s+)?(?:running|operating|working|open|closed|delays?|delayed|disruptions?|disrupted|suspended)\b`;
export const NON_PINT_DRINK_RE = /\b(?:wine|cocktails?|spirits?|coffee|whisk(?:y|ey)|gin|rum|vodka|shots?|soft drinks?|alcohol[- ]free|non[- ]alcoholic)\b/i;
export const ITEM_PRICE_RE = /\b(?:how much(?:\s+(?:is|are|does|for))?|prices?(?:\s+(?:of|for))?|costs?(?:\s+(?:of|for))?)\b/i;

export function askRequestClauses(query: string): string[] {
  const pricePrefix = String.raw`(?:${NON_PINT_DRINK_RE.source}|pints?|beer|drinks?)\s+${ITEM_PRICE_RE.source}`;
  return query.split(new RegExp(String.raw`(?:\s+and\s+|,\s*|(?<=[.!?])\s+)(?=(?:(?:can|could|would|will)\s+you\s+)?(?:please\s+)?(?:any\s+)?(?:${TRANSIT_INTERROGATIVE_PREFIX}|${pricePrefix}|${ITEM_PRICE_RE.source}|how\b|what\b|where\b|find\b|show\b|include\b|give\b|plan\b|directions (?:to|from)\b|route (?:to|from)\b|get (?:me )?to\b|tube delays?\b|transit delays?\b|weather\b|city status\b|cheap(?:est)?\b|best value\b|lowest price\b|most affordable\b))`, "i"));
}

const TIME_QUALIFIER = String.raw`tonight|right now|now|later|today|this evening|this afternoon|this morning|this weekend`;
const DAY_QUALIFIER = String.raw`(?:on|this|next)\s+(?:mon|tues|wednes|thurs|fri|satur|sun)day(?:\s+(?:night|evening))?`;
const TRAILING_QUALIFIER = String.raw`${TIME_QUALIFIER}|${DAY_QUALIFIER}|with mates|for (?:two|three|four|five|six|seven|eight|nine|ten|a few|\d+)(?:\s+(?:of us|people))?`;
const TRAILING_QUALIFIER_RE = new RegExp(String.raw`(?:^|\s+)(?:${TRAILING_QUALIFIER})\s*$`, "i");

export function stripTrailingPunctuation(phrase: string): string {
  return phrase.replace(/[?.!,;:]+$/g, "").trim();
}

export function stripTrailingQualifiers(phrase: string): string {
  let current = phrase.trim();
  for (;;) {
    const next = current.replace(TRAILING_QUALIFIER_RE, "").trim();
    if (next === current) return current;
    current = next;
  }
}

const PRICE_PRESENTATION_FIELD = String.raw`(?:(?:(?:pint\s+)?price\s+)?(?:sources?|(?:(?:source|recorded)\s+)?dates?)|map)`;
const PRICE_PRESENTATION_CONTEXT = String.raw`\s+(?:for|of|on|behind)\s+(?:(?:any|each|every|all|the)\s+)?(?:(?:listed|recorded)\s+)?(?:pint\s+)?prices?(?:\s+(?:(?:that|which)\s+)?you\s+(?:use|show|quote|mention|include))?`;
const MAP_VIEW_VERBS = String.raw`(?:show|open|see|view|pull up|bring up|load|display|go to|go back to|back to|take me to|take me back to|switch to|get me|give me|let me see)`;
const POLITE_COMMAND_PREFIX = String.raw`(?:(?:can|could|would|will)\s+you\s+)?(?:please\s+)?`;
const PRESENTATION_CLAUSE_START = String.raw`(?:^\s*|(?<=[.!?;,]|\band\b)\s*|\s+and\s+)`;
const GENERIC_MAP_COMMAND = String.raw`(?:\b(?:i\s+want\s+to\s+)?${POLITE_COMMAND_PREFIX}${MAP_VIEW_VERBS}(?:\s+(?:me|up|back|to|the|a|my|pub|whole|full)){0,4}\s+maps?|${PRESENTATION_CLAUSE_START}${POLITE_COMMAND_PREFIX}(?:(?:the|a|my)\s+)?(?:(?:whole|full)\s+)?maps?)(?:\s+view)?(?:\s+for\s+the\s+next\s+(?:stop|pub|bar|one|place))?`;
const PRESENTATION_CLAUSE_END = String.raw`(?:(?:\s+|\s*,\s*)(?:(?:for\s+)?(?:${TIME_QUALIFIER})|please|then|for me|mate))*\s*(?!and\s+(?:the\s+)?${PRICE_PRESENTATION_FIELD}\b)(?:[.!?;,]+(?:\s+and\b)?|\band\b|(?=(?:for|with)\b)|$)`;
// "Show me the map with prices" asks for the map as it already is, price pins
// and all. The tail belongs to the map clause, so it never becomes a price or
// venue subject, and the preserved map command omits it.
const MAP_PRICE_PINS = String.raw`(?:\s*,?\s+with\s+(?:the\s+)?(?:(?:pint|listed)\s+)?prices)?`;
export const GENERIC_MAP_COMMAND_RE = new RegExp(
  String.raw`(?<mapCommand>${GENERIC_MAP_COMMAND})${MAP_PRICE_PINS}(?!${PRICE_PRESENTATION_CONTEXT})${PRESENTATION_CLAUSE_END}`,
  "i",
);
const ASK_PRESENTATION_CLAUSE_RE = new RegExp(
  String.raw`${GENERIC_MAP_COMMAND_RE.source}|(?:${PRESENTATION_CLAUSE_START})?\b(?<command>${POLITE_COMMAND_PREFIX}(?:show|include|give|cite|list|add|with)(?:\s+me)?\s+(?:the\s+)?)(?<fields>${PRICE_PRESENTATION_FIELD}(?:\s+and\s+(?:the\s+)?${PRICE_PRESENTATION_FIELD})*)(?<priceContext>${PRICE_PRESENTATION_CONTEXT})?${PRESENTATION_CLAUSE_END}`,
  "gi",
);

// A refusal of navigation: "don't", "hold off", "stop", "not yet", "not now",
// or a clause that opens with "not" ("Map. Not yet.", "No, not the map").
// A "not" inside an ordinary clause ("I'm not sure where I am") refuses
// nothing, and the noun in "next stop" is not a refusal either.
const NAVIGATION_REFUSAL_RE = new RegExp(String.raw`\b(?:don'?t|do not|dont|never|no need to|stop|hold off)\b|\bnot\s+(?:yet|now|right now|today|tonight|anymore|any more|please)\b|(?:^|[.!?;,]\s*|\bno\s+)not\b(?!\s+(?:sure|too|far|that|very|so|much|many|more|less|quite|really)\b)`);

/** Does the person, in their own words, refuse a map or next-stop move? */
export function navigationIsRefused(text: string): boolean {
  const normalized = text
    .toLowerCase()
    .replace(/[’`]/g, "'")
    .replace(/\s+/g, " ")
    .replace(/\bnext[\s\p{Pd}]+stop\b/gu, "");
  return NAVIGATION_REFUSAL_RE.test(normalized);
}

/** Service parsers omit map commands so those commands cannot become venue or price subjects. */
export function semanticAskRequest(query: string, preserveMapCommands = true): string {
  const clauses = [...query.matchAll(ASK_PRESENTATION_CLAUSE_RE)];
  if (!clauses.length) return query;
  const requests: string[] = [];
  let end = 0;
  for (const clause of clauses) {
    requests.push(query.slice(end, clause.index).trim());
    if (preserveMapCommands) {
      if (clause.groups!.mapCommand) requests.push(clause.groups!.mapCommand);
      else if (/\bmap\b/i.test(clause.groups!.fields!) && !clause.groups!.priceContext) {
        requests.push(`${clause.groups!.command}map`);
      }
    }
    end = clause.index + clause[0].length;
  }
  requests.push(query.slice(end).trim());
  return requests.filter(Boolean).reduce((request, part) =>
    request ? `${request}${/[.!?]$/.test(request) ? " " : ". "}${part}` : part, "");
}
