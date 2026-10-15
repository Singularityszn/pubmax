export const PLAN_PRICE_AMOUNT = String.raw`(?:£\s*(\d+(?:[.,]\d{1,2})?)(?!\d|[.,]\d)|(\d+(?:[.,]\d{1,2})?)\s*(?:pounds?|quid)\b)`;
const LIMIT = String.raw`(?:under|below|up to|less than|max(?:imum)?)`;
export const PLAN_DRINK_BEFORE_PRICE = new RegExp(String.raw`\b(pints?|drinks?|beers?)\b\s+(?:(?:priced|cost(?:s|ing)?)\s+)?(?:(?:for|at)\s+)?(?:${LIMIT}\s*)?$`, "i");
export const PLAN_DRINK_AFTER_PRICE = /^\s*(?:(?:for|per)\s+)?(?:(?:an?|one|each)\s+)?(pints?|drinks?|beers?)\b/i;

export function planPriceAmounts(query: string): Array<{
  index: number;
  end: number;
  pence: number;
  pintRate: boolean;
}> {
  return [...query.matchAll(new RegExp(PLAN_PRICE_AMOUNT, "gi"))].map((amount) => {
    const end = amount.index + amount[0].length;
    const beforeDrink = PLAN_DRINK_BEFORE_PRICE.exec(query.slice(0, amount.index));
    const afterDrink = PLAN_DRINK_AFTER_PRICE.exec(query.slice(end));
    return {
      index: amount.index,
      end,
      pence: Math.round(Number((amount[1] ?? amount[2]!).replace(",", ".")) * 100),
      pintRate: /^pints?$/i.test(beforeDrink?.[1] ?? "") || /^pints?$/i.test(afterDrink?.[1] ?? ""),
    };
  });
}

export function planPriceLimits(...queries: string[]): {
  pintCeiling: number | null;
  routeBudgetPence: number | null;
} {
  const amounts = queries.flatMap((query) => planPriceAmounts(query).map((amount) => ({ ...amount, query })));
  const pintPrices = amounts.filter((amount) => amount.pintRate).map((amount) => amount.pence);
  const routePrices = amounts.filter((amount) => !amount.pintRate
    && new RegExp(String.raw`\b(?:${LIMIT}|budget(?: of)?)\s*$`, "i").test(amount.query.slice(0, amount.index)))
    .map((amount) => amount.pence);
  return {
    pintCeiling: pintPrices.length ? Math.min(...pintPrices) / 100 : null,
    routeBudgetPence: routePrices.length ? Math.min(...routePrices) : null,
  };
}
