const AMOUNT = String.raw`£\s*(\d{1,3}(?:[.,]\d{1,2})?)(?!\d|[.,]\d)`;
const LIMIT = String.raw`(?:under|below|up to|less than|max(?:imum)?)`;

export function planPriceLimits(query: string): {
  pintCeiling: number | null;
  routeBudgetPence: number | null;
} {
  const pintPrices: number[] = [];
  const withoutPintRates = query.replace(
    new RegExp(String.raw`\bpints?\s+(?:${LIMIT}\s*)?${AMOUNT}|(?:\b${LIMIT}\s*)?${AMOUNT}\s*(?:per|a|each)\s+pints?\b|${AMOUNT}\s+pints?\b`, "gi"),
    (_match, before: string | undefined, after: string | undefined, front: string | undefined) => {
      pintPrices.push(Math.round(Number((before ?? after ?? front!).replace(",", ".")) * 100));
      return " ";
    },
  );
  const routePrices = [...withoutPintRates.matchAll(
    new RegExp(String.raw`\b(?:${LIMIT}|budget(?: of)?)\s*${AMOUNT}`, "gi"),
  )].map((match) => Math.round(Number(match[1]!.replace(",", ".")) * 100));
  return {
    pintCeiling: pintPrices.length ? Math.min(...pintPrices) / 100 : null,
    routeBudgetPence: routePrices.length ? Math.min(...routePrices) : null,
  };
}
