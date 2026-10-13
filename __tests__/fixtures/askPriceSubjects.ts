const UNSUPPORTED_DISCOVERY_PRICES = [
  ["a glass of wine", "UNSUPPORTED_DRINK_PRICE_COMPARISON", /other drinks across pubs/i],
  ["glasses of wine", "UNSUPPORTED_DRINK_PRICE_COMPARISON", /other drinks across pubs/i],
  ["a burger", "UNSUPPORTED_FOOD_PRICE_COMPARISON", /meal prices|dietary/i],
  ["burgers", "UNSUPPORTED_FOOD_PRICE_COMPARISON", /meal prices|dietary/i],
  ["bottles of Coke", "UNSUPPORTED_PRICE_COMPARISON", /not prices for that item/i],
  ["wine", "UNSUPPORTED_DRINK_PRICE_COMPARISON", /other drinks across pubs/i],
  ["food", "UNSUPPORTED_FOOD_PRICE_COMPARISON", /meal prices|dietary/i],
  ["Coke", "UNSUPPORTED_PRICE_COMPARISON", /not prices for that item/i],
] as const;

export const QUALIFIED_PRICE_REQUESTS = UNSUPPORTED_DISCOVERY_PRICES.flatMap(([subject, code, wording]) => [
  `In Soho, ${subject} prices`,
  `At the cheapest pub in Soho, ${subject} prices`,
  `${subject} in Soho costs at the cheapest pub`,
  `How much is ${subject} at the cheapest pub in Soho?`,
  `How much at the cheapest pub in Soho for ${subject}?`,
  `${subject} prices at the cheapest pub in Soho`,
  `${subject} costs at the cheapest pub in Soho`,
  `What does ${subject} at the cheapest pub in Soho cost?`,
  `Prices for ${subject} at the cheapest pub in Soho`,
  `Somewhere cheap for ${subject} in Soho`,
  `Cheapest for ${subject} in Soho`,
  `Somewhere cheap in Soho for ${subject}`,
  `Somewhere cheap ${subject} in Soho`,
  `Somewhere cheap ${subject} for four in Soho`,
  `Somewhere cheap pints in Soho for ${subject}`,
].map((query) => ({ query, code, wording })));
