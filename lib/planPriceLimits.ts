export const PLAN_PRICE_AMOUNT = String.raw`(?:£\s*(\d+(?:[.,]\d{1,2})?)(?!\d|[.,]\d)|(\d+(?:[.,]\d{1,2})?)\s*(?:pounds?|quid)\b)`;
const LIMIT = String.raw`(?:under|below|up to|less than|max(?:imum)?)`;
export const PLAN_DRINK_ITEM = String.raw`(?:pints?|drinks?|beers?)`;
const DRINK_SUBJECT = String.raw`(?:(?:half[ -](?:a\s+)?|(?:bottled|canned|two|three|four|five|six|\d+)\s+|(?:bottles?|cans?|glass(?:es)?|shots?)\s+of\s+))?(?:${PLAN_DRINK_ITEM}|bottles?|cans?|cocktails?|glass(?:es)?|shots?)(?:\s+(?:bottles?|cans?|glass(?:es)?|shots?))?`;
const PLAN_DRINK_BEFORE_PRICE = new RegExp(String.raw`\b(${DRINK_SUBJECT})\b\s+(?:(?:priced|cost(?:s|ing)?)\s+)?(?:(?:for|at)\s+)?(?:${LIMIT}\s*)?$`, "i");
const PLAN_DRINK_AFTER_PRICE = new RegExp(String.raw`^\s*(?:(?:for|per|each)\s+)?(?:(?:an?|one|each)\s+)?(${DRINK_SUBJECT})\b`, "i");

export function planPriceAmounts(query: string): Array<{
  index: number;
  end: number;
  pence: number;
  drink: {
    beforeStart: number | null;
    afterEnd: number | null;
    perServing: boolean;
    supported: boolean;
  } | null;
}> {
  return [...query.matchAll(new RegExp(PLAN_PRICE_AMOUNT, "gi"))].map((amount) => {
    const end = amount.index + amount[0].length;
    const beforeDrink = PLAN_DRINK_BEFORE_PRICE.exec(query.slice(0, amount.index));
    const afterDrink = PLAN_DRINK_AFTER_PRICE.exec(query.slice(end));
    return {
      index: amount.index,
      end,
      pence: Math.round(Number((amount[1] ?? amount[2]!).replace(",", ".")) * 100),
      drink: beforeDrink || afterDrink ? {
        beforeStart: beforeDrink?.index ?? null,
        afterEnd: afterDrink?.[0].length ?? null,
        perServing: /^\s*(?:per|a|each)\s+/i.test(afterDrink?.[0] ?? ""),
        supported: [beforeDrink, afterDrink].every((match) => !match || new RegExp(`^${PLAN_DRINK_ITEM}$`, "i").test(match[1]!)),
      } : null,
    };
  });
}

export function planPriceLimits(...queries: string[]): {
  pintCeiling: number | null;
  routeBudgetPence: number | null;
} {
  const amounts = queries.flatMap((query) => planPriceAmounts(query).map((amount) => ({ ...amount, query })));
  const pintPrices = amounts.filter((amount) => amount.drink?.supported).map((amount) => amount.pence);
  const routePrices = amounts.filter((amount) => !amount.drink
    && new RegExp(String.raw`\b(?:${LIMIT}|budget(?: of)?)\s*$`, "i").test(amount.query.slice(0, amount.index)))
    .map((amount) => amount.pence);
  return {
    pintCeiling: pintPrices.length ? Math.min(...pintPrices) / 100 : null,
    routeBudgetPence: routePrices.length ? Math.min(...routePrices) : null,
  };
}
