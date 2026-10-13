const UNSUPPORTED_DISCOVERY_PRICES = [
  ["wine", "UNSUPPORTED_DRINK_PRICE_COMPARISON", /other drinks across pubs/i],
  ["food", "UNSUPPORTED_FOOD_PRICE_COMPARISON", /meal prices|dietary/i],
  ["Coke", "UNSUPPORTED_PRICE_COMPARISON", /not prices for that item/i],
] as const;

export const QUALIFIED_PRICE_REQUESTS = UNSUPPORTED_DISCOVERY_PRICES.flatMap(([subject, code, wording]) => [
  `Somewhere cheap for ${subject} in Soho`,
  `Cheapest for ${subject} in Soho`,
  `Somewhere cheap in Soho for ${subject}`,
  `Somewhere cheap ${subject} in Soho`,
  `Somewhere cheap ${subject} for four in Soho`,
  `Somewhere cheap pints in Soho for ${subject}`,
].map((query) => ({ query, code, wording })));
