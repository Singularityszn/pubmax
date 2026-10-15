export const PLAN_PRICE_AMOUNT = String.raw`(?:£\s*(\d+(?:[.,]\d{1,2})?)(?!\d|[.,]\d)|(\d+(?:[.,]\d{1,2})?)\s*(?:pounds?|quid)\b)`;
const LIMIT = String.raw`(?:under|below|up to|less than|max(?:imum)?)`;
export const PLAN_DRINK_ITEM = String.raw`(?:pints?|drinks?|beers?)`;
const MEASURED_SERVING = String.raw`\d+(?:[.,]\d+)?\s*[a-z]+`;
const DRINK_CONTAINER = String.raw`(?:bottles?|cans?|glass(?:es)?|shots?|jugs?|litres?|packs?|pitchers?|steins?|six-packs?)`;
const SERVING_QUANTITY = String.raw`(?:an?|the|each|one|two|three|four|five|six|seven|eight|nine|ten|half|quarter|double|triple|several|few|dozen|\d+(?:/\d+)?)`;
const SERVING_PREFIX = String.raw`(?:(?:${MEASURED_SERVING}|bottled|canned|${SERVING_QUANTITY})[ -]+(?:of\s+)?|${SERVING_QUANTITY}\s*[x×]\s*)`;
const DRINK_NOUN = String.raw`(?:${PLAN_DRINK_ITEM}|${DRINK_CONTAINER}|cocktails?)`;
export const PLAN_VENUE_AMENITY = String.raw`(?:\d+|one|two|three|four|five|six)\s+(?:pubs?|bars?|stops?)\s+(?:serving|serves|where|with)\b`;
const LOCATION_START = String.raw`(?:at|in|from|near|around|within|inside|outside|by|where)`;
const PLAN_PRICE_SUBJECT_BOUNDARY = String.raw`\b(?:with|per|each|afterwards|later|${LOCATION_START}|${PLAN_VENUE_AMENITY})\b`;
const FOOD_SERVING_QUALIFIER = String.raw`(?:${SERVING_QUANTITY}\s+(?:of\s+)?)+(?:(?!(?:${DRINK_NOUN}|pubs?|bars?|stops?|venues?|pounds?|quid|serving|serves|and|plus|for|${LIMIT})\b|${PLAN_PRICE_SUBJECT_BOUNDARY})[a-z]+[ -]+)*`;
const FOOD_SERVING_NOUN = String.raw`servings?(?:[ -]+(?!(?:${LOCATION_START}|per|each|afterwards|later|and|plus|priced|cost(?:s|ing)?|${LIMIT}|${DRINK_NOUN}|pubs?|bars?|stops?|venues?)\b|${PLAN_PRICE_AMOUNT})[a-z0-9]+(?:/\d+)?)*`;
export const PLAN_FOOD_ITEM = String.raw`(?:${FOOD_SERVING_NOUN}|meals?|slices?|portions?|lunch|dinner|breakfast|dish(?:es)?|food|eat|pizzas?|burgers?|kebabs?|chips|(?:Sunday\s+)?roasts?|steaks?|sandwich(?:es)?|salads?|curr(?:y|ies))`;
const CONTENTS_WORD = String.raw`(?!(?:and|plus|for|under|below|up|less|than|max(?:imum)?|priced|cost(?:s|ing)?)\b|${PLAN_PRICE_SUBJECT_BOUNDARY})[a-z]+`;
const DRINK_SUBJECT = String.raw`(?:${SERVING_PREFIX})*${DRINK_NOUN}(?:\s+of\s+(?:${MEASURED_SERVING}|${CONTENTS_WORD}|\d+(?:/\d+)?)(?:[ -]+(?:${MEASURED_SERVING}|${CONTENTS_WORD}|\d+(?:/\d+)?))*)?(?:\s+(?:${MEASURED_SERVING}|${DRINK_CONTAINER}))?`;
const PLAN_DRINK_BEFORE_PRICE = new RegExp(String.raw`\b(${DRINK_SUBJECT})\b\s+(?:(?:priced|cost(?:s|ing)?)\s+)?(?:(?:for|at)\s+)?(?:${LIMIT}\s*)?$`, "i");
const PLAN_DRINK_AFTER_PRICE = new RegExp(String.raw`^\s*(?:(?:for|per|each)\s+)?(${DRINK_SUBJECT})\b`, "i");
const SUPPORTED_DRINK_SUBJECT = new RegExp(String.raw`^(?:(?:an?|each|one|1)\s+)?(?:${PLAN_DRINK_ITEM}|pint\s+of\s+(?:the\s+)?beer)$`, "i");
const EXPLICIT_ROUTE_BUDGET = new RegExp(String.raw`\b(?:(?:pubs?(?:\s+route)?|bars?|stops?|crawl|route|total|per[ -]person)\s+budget|(?:pubs?|crawl|route)\s+total)(?:\s+of)?(?:\s+${LIMIT})?\s*$`, "i");
const ROUTE_BUDGET_PREFIX = new RegExp(String.raw`\bbudget(?:\s+of)?(?:\s+${LIMIT})?\s*$`, "i");
const ROUTE_LIMIT_PREFIX = new RegExp(String.raw`\b${LIMIT}\s*$`, "i");

export const PLAN_FOOD_SUBJECT = String.raw`(?:(?!(?:${PLAN_PRICE_SUBJECT_BOUNDARY}|\b(?:serves|for|priced|cost(?:s|ing)?|${LIMIT})\b))[^,£;!?])*\b${PLAN_FOOD_ITEM}\b`;
const LOCATION_LIST = String.raw`(?:\b(?:and|plus)\b|[+&])\s*(?:${PLAN_FOOD_SUBJECT}|${DRINK_SUBJECT}\b)`;
const LOCATION_MODIFIER = new RegExp(String.raw`^(?:\b(?:with|serving|serves)\s+${PLAN_FOOD_SUBJECT}\b|(?!${PLAN_PRICE_AMOUNT}|[,;.!?]|${LOCATION_LIST}|\b(?:${LIMIT}|priced|cost(?:s|ing)?|for)\b)[\s\S])*`, "i");
const VENUE_NAME_WORD = String.raw`[A-Z][a-z][a-zA-Z'’]*`;
const VENUE_NAME_PART = String.raw`${VENUE_NAME_WORD}(?:\s+${VENUE_NAME_WORD})*`;
const COORDINATED_VENUE_NAME = new RegExp(String.raw`^\s+(?!(?:The\s+)?(?:Pubs?|Bars?|Stops?)\b)${VENUE_NAME_PART}(?:(?:\s+(?:and|plus)\s+|\s*[+&]\s*)${VENUE_NAME_PART})+\b`);
const SUBJECT_LOCATION = new RegExp(String.raw`(\b(?:${DRINK_SUBJECT}|${PLAN_FOOD_SUBJECT})\b|${PLAN_PRICE_AMOUNT})(\s+${LOCATION_START}\b)`, "gi");
const FOLLOWING_PRICE = new RegExp(String.raw`^\s*(?:(?:priced|cost(?:s|ing)?)\s+)?(?:for\s*)?(?:${LIMIT}\s*)?${PLAN_PRICE_AMOUNT}`, "i");
const LOCATION_FOOD = new RegExp(String.raw`\b${PLAN_FOOD_SUBJECT}`, "i");

function planPriceLocationSpans(value: string): Array<{ start: number; end: number }> {
  const spans: Array<{ start: number; end: number }> = [];
  const locations = new RegExp(SUBJECT_LOCATION);
  let match: RegExpExecArray | null;
  while ((match = locations.exec(value))) {
    const start = match.index + match[1]!.length;
    const nameEnd = locations.lastIndex + (COORDINATED_VENUE_NAME.exec(value.slice(locations.lastIndex))?.[0].length ?? 0);
    let end = nameEnd + LOCATION_MODIFIER.exec(value.slice(nameEnd))![0].length;
    const modifier = value.slice(nameEnd, end);
    const food = LOCATION_FOOD.exec(modifier);
    if (food && FOLLOWING_PRICE.test(value.slice(end))) {
      const amenity = /\b(?:with|serving|serves|where)\b/i.exec(modifier.slice(0, food.index));
      end = nameEnd + (amenity?.index ?? food.index);
    }
    spans.push({ start, end });
    locations.lastIndex = end;
  }
  return spans;
}

export function planPriceSubjectText(value: string): string {
  value = value.replace(/\bserving\b/gi, (word: string, index: number) => {
    const before = value.slice(0, index).replace(new RegExp(PLAN_PRICE_AMOUNT, "gi"), (amount) => " ".repeat(amount.length));
    const after = value.slice(index + word.length);
    const qualified = new RegExp(String.raw`${FOOD_SERVING_QUALIFIER}$`, "i").test(before);
    const predicate = new RegExp(String.raw`^\s+(?!(?:of|to|for|and|plus|priced|cost(?:s|ing)?|${LIMIT})\b|${PLAN_PRICE_SUBJECT_BOUNDARY}|${PLAN_PRICE_AMOUNT})[a-z0-9]`, "i").test(after);
    return !qualified && predicate ? "serves " : word;
  });
  const spans = planPriceLocationSpans(value);
  let text = "";
  let offset = 0;
  for (const { start, end } of spans) {
    text += value.slice(offset, start) + " ".repeat(end - start);
    offset = end;
  }
  return text + value.slice(offset);
}

export function planPriceAmounts(query: string): Array<{
  index: number;
  end: number;
  pence: number;
  routeBudget: "explicit" | "limit" | null;
  drink: {
    beforeStart: number | null;
    afterEnd: number | null;
    perServing: boolean;
    supported: boolean;
  } | null;
}> {
  query = planPriceSubjectText(query);
  return [...query.matchAll(new RegExp(PLAN_PRICE_AMOUNT, "gi"))].map((amount) => {
    const end = amount.index + amount[0].length;
    const before = query.slice(0, amount.index);
    const after = query.slice(end);
    const explicitRouteBudget = EXPLICIT_ROUTE_BUDGET.test(before);
    const beforeDrink = PLAN_DRINK_BEFORE_PRICE.exec(before);
    const afterDrink = PLAN_DRINK_AFTER_PRICE.exec(after);
    return {
      index: amount.index,
      end,
      pence: Math.round(Number((amount[1] ?? amount[2]!).replace(",", ".")) * 100),
      routeBudget: explicitRouteBudget ? "explicit"
        : ROUTE_BUDGET_PREFIX.test(before) || (!beforeDrink && !afterDrink && ROUTE_LIMIT_PREFIX.test(before)) ? "limit" : null,
      drink: beforeDrink || afterDrink ? {
        beforeStart: beforeDrink?.index ?? null,
        afterEnd: afterDrink?.[0].length ?? null,
        perServing: /^\s*(?:per|a|each)\s+/i.test(afterDrink?.[0] ?? ""),
        supported: [beforeDrink, afterDrink].every((match) => !match || SUPPORTED_DRINK_SUBJECT.test(match[1]!)),
      } : null,
    };
  });
}

export function planPriceLimits(...queries: string[]): {
  pintCeiling: number | null;
  routeBudgetPence: number | null;
} {
  const amounts = queries.flatMap(planPriceAmounts);
  const pintPrices = amounts.filter((amount) => !amount.routeBudget && amount.drink?.supported).map((amount) => amount.pence);
  const routePrices = amounts.filter((amount) => amount.routeBudget).map((amount) => amount.pence);
  return {
    pintCeiling: pintPrices.length ? Math.min(...pintPrices) / 100 : null,
    routeBudgetPence: routePrices.length ? Math.min(...routePrices) : null,
  };
}
