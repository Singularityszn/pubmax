export const PLAN_PRICE_AMOUNT = String.raw`(?:£\s*(\d+(?:[.,]\d{1,2})?)(?!\d|[.,]\d)|(\d+(?:[.,]\d{1,2})?)\s*(?:pounds?|quid)\b)`;
const LIMIT = String.raw`(?:under|below|up to|less than|max(?:imum)?)`;
export const PLAN_DRINK_ITEM = String.raw`(?:pints?|drinks?|beers?)`;
const MEASURED_SERVING = String.raw`\d+(?:[.,]\d+)?\s*[a-z]+`;
const DRINK_CONTAINER = String.raw`(?:bottles?|cans?|glass(?:es)?|shots?|jugs?|litres?|packs?|pitchers?|steins?|six-packs?)`;
const SERVING_QUANTITY = String.raw`(?:an?|the|each|one|two|three|four|five|six|seven|eight|nine|ten|half|quarter|double|triple|several|few|dozen|\d+(?:/\d+)?)`;
const SERVING_PREFIX = String.raw`(?:(?:${MEASURED_SERVING}|bottled|canned|${SERVING_QUANTITY})[ -]+(?:of\s+)?|${SERVING_QUANTITY}\s*[x×]\s*)`;
const DRINK_NOUN = String.raw`(?:${PLAN_DRINK_ITEM}|${DRINK_CONTAINER}|cocktails?)`;
export const PLAN_FOOD_ITEM = String.raw`(?:meals?|lunch|dinner|breakfast|dish(?:es)?|food|eat|pizzas?|burgers?|kebabs?|chips|(?:Sunday\s+)?roasts?|steaks?|sandwich(?:es)?|salads?|curr(?:y|ies))`;
export const PLAN_VENUE_AMENITY = String.raw`(?:\d+|one|two|three|four|five|six)\s+(?:pubs?|bars?|stops?)\s+(?:serving|serves|where|with)\b`;
const LOCATION_START = String.raw`(?:at|in|from|near|around|within|inside|outside|by|where)`;
export const PLAN_PRICE_SUBJECT_BOUNDARY = String.raw`\b(?:with|per|each|afterwards|later|${LOCATION_START}|${PLAN_VENUE_AMENITY})\b`;
const CONTENTS_WORD = String.raw`(?!(?:and|plus|for|under|below|up|less|than|max(?:imum)?|priced|cost(?:s|ing)?)\b|${PLAN_PRICE_SUBJECT_BOUNDARY})[a-z]+`;
const DRINK_SUBJECT = String.raw`(?:${SERVING_PREFIX})*${DRINK_NOUN}(?:\s+of\s+(?:${MEASURED_SERVING}|${CONTENTS_WORD}|\d+(?:/\d+)?)(?:[ -]+(?:${MEASURED_SERVING}|${CONTENTS_WORD}|\d+(?:/\d+)?))*)?(?:\s+(?:${MEASURED_SERVING}|${DRINK_CONTAINER}))?`;
const PLAN_DRINK_BEFORE_PRICE = new RegExp(String.raw`\b(${DRINK_SUBJECT})\b\s+(?:(?:priced|cost(?:s|ing)?)\s+)?(?:(?:for|at)\s+)?(?:${LIMIT}\s*)?$`, "i");
const PLAN_DRINK_AFTER_PRICE = new RegExp(String.raw`^\s*(?:(?:for|per|each)\s+)?(${DRINK_SUBJECT})\b`, "i");
const SUPPORTED_DRINK_SUBJECT = new RegExp(String.raw`^(?:(?:an?|each|one|1)\s+)?(?:${PLAN_DRINK_ITEM}|pint\s+of\s+(?:the\s+)?beer)$`, "i");
const EXPLICIT_ROUTE_BUDGET = new RegExp(String.raw`\b(?:(?:pubs?(?:\s+route)?|bars?|stops?|crawl|route|total|per[ -]person)\s+budget|(?:pubs?|crawl|route)\s+total)(?:\s+of)?(?:\s+${LIMIT})?\s*$`, "i");
const ROUTE_BUDGET_PREFIX = new RegExp(String.raw`\bbudget(?:\s+of)?(?:\s+${LIMIT})?\s*$`, "i");
const ROUTE_LIMIT_PREFIX = new RegExp(String.raw`\b${LIMIT}\s*$`, "i");

const LOCATION_ITEM = String.raw`(?:(?:${SERVING_QUANTITY}|pub)[ -]+)*(?:${PLAN_FOOD_ITEM}|${DRINK_NOUN})\b`;
const LOCATION_LIST = String.raw`(?:\b(?:and|plus)\b|[+&])\s*${LOCATION_ITEM}`;
const LOCATION_MODIFIER = String.raw`${LOCATION_START}\b(?:(?!${PLAN_PRICE_AMOUNT}|[,;.!?]|${LOCATION_LIST}|\b(?:${LIMIT}|priced|cost(?:s|ing)?|for)\b)[\s\S])*`;
const SUBJECT_LOCATION = new RegExp(String.raw`(\b(?:${DRINK_SUBJECT}|${PLAN_FOOD_ITEM})\b|${PLAN_PRICE_AMOUNT})(\s+${LOCATION_MODIFIER})`, "gi");
const FOLLOWING_PRICE = new RegExp(String.raw`^\s*(?:(?:priced|cost(?:s|ing)?)\s+)?(?:for\s*)?(?:${LIMIT}\s*)?${PLAN_PRICE_AMOUNT}`, "i");
const LOCATION_FOOD = new RegExp(String.raw`\b${PLAN_FOOD_ITEM}\b`, "i");

function planPriceLocationSpans(value: string): Array<{ start: number; end: number }> {
  return [...value.matchAll(SUBJECT_LOCATION)].map((match) => {
    const start = match.index + match[1]!.length;
    let end = match.index + match[0].length;
    const modifier = value.slice(start, end);
    const food = LOCATION_FOOD.exec(modifier);
    if (food && FOLLOWING_PRICE.test(value.slice(end))) {
      const amenity = /\b(?:with|serving|serves|where)\b/i.exec(modifier.slice(0, food.index));
      end = start + (amenity?.index ?? food.index);
    }
    return { start, end };
  });
}

export function planPriceSubjectText(value: string): string {
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
