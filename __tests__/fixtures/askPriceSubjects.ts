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
  `Find me ${subject} at the cheapest pub in Soho`,
  `Somewhere cheap in Soho with ${subject}`,
  `Somewhere cheap in Soho and ${subject}`,
  ...(subject === "food" ? [] : [
    `Find me the cheapest pub in Soho, with ${subject} near the Tube`,
    `Find me the cheapest pub in Soho with ${subject} near a station`,
  ]),
  `Somewhere cheap for ${subject} near the Tube`,
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

export const JOURNEY_ENDPOINT_REQUESTS = [
  { query: "How do I get from Kings Cross to Fox and Anchor?", from: "Kings Cross", to: "51.52042,-0.10071", venueId: "venue-phg4ss", name: "Fox and Anchor" },
  { query: "Directions to Fox and Anchor from Kings Cross", from: "Kings Cross", to: "51.52042,-0.10071", venueId: "venue-phg4ss", name: "Fox and Anchor" },
  { query: "Directions to Fox and Anchor from Kings Cross right now", from: "Kings Cross", to: "51.52042,-0.10071", venueId: "venue-phg4ss", name: "Fox and Anchor" },
  { query: "How can I get from Fox & Anchor to Fox and Firkin tonight?", from: "51.52042,-0.10071", to: "51.45690,-0.01438", venueId: "venue-xoqiq5", name: "Fox and Firkin" },
  { query: "Route to Fox & Anchor from Fox and Firkin", from: "51.45690,-0.01438", to: "51.52042,-0.10071", venueId: "venue-phg4ss", name: "Fox and Anchor" },
  { query: "Any tube delays and directions to The Black Friar, Blackfriars from Kings Cross?", from: "Kings Cross", to: "51.51210,-0.10368", venueId: "venue-eltcmh", name: "The Blackfriar" },
];

export const NAMED_TERMINAL_PRICE_REQUESTS = [
  "What does the cheapest pint at The Blackfriar cost?",
  "What does a pint at The Black Friar, Blackfriars cost tonight?",
  "What do pints at The Blackfriar cost?",
  "How much is a pint right now at The Blackfriar?",
];
