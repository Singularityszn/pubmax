// Soft cuisine / plate tags for food-serving pubs (Wave E — food light).
//
// Tags are lowercase tokens shown as chips in the venue overview and used by
// Discover's "Hungry?" deep-link. They NEVER invent amenity flags — a venue
// without food still won't pass requireFood. Membership is:
//   1. curated map by venue id (small, hand-picked), OR
//   2. keyword hits in searchText / name (roast, thai, pizza, …).
//
// Pure helpers — unit-tested in __tests__/cuisineTags.test.ts.

/** Soft plate / cuisine tokens we recognise in copy and the curated seed. */
export const KNOWN_CUISINE_TAGS = [
  "roast",
  "thai",
  "pizza",
  "burger",
  "tapas",
  "italian",
  "indian",
  "steak",
  "grill",
  "pie",
  "fish",
  "kitchen",
  "gastropub",
  "chinese",
  "mexican",
] as const;

export type CuisineTag = (typeof KNOWN_CUISINE_TAGS)[number];

const KNOWN_SET = new Set<string>(KNOWN_CUISINE_TAGS);

// Small curated map for well-known food pubs (ids from venues_slim / crawls).
// Keep honest: only venues that actually serve food in the dataset.
export const CURATED_CUISINE_BY_VENUE_ID: Readonly<Record<string, readonly string[]>> = {
  "venue-1ufn31x": ["roast", "gastropub"], // The Nellie Dean
  "venue-1t8siin": ["gastropub"], // The Crown & Two Chairmen
  "venue-xiesdn": ["gastropub"], // The Dog & Duck
  "venue-phqazo": ["gastropub"], // The Coach & Horses
  "venue-15i2wst": ["roast", "gastropub"], // Golden Lion (Soho)
  "venue-1gs68ga": ["roast", "pie"], // The George (Borough)
  "venue-2e3otf": ["gastropub"], // The Barrowboy & Banker
  "venue-ral8ik": ["burger"], // Honest Burger Tower Hill
  "venue-140rjwt": ["tapas"], // Tapas Brindisa London Bridge
  "venue-xmy0sb": ["italian"], // Symposium Italian
  "venue-17zuc81": ["italian"], // Bacco Ristorante Italiano
  "venue-11lnj4t": ["steak"], // Bar + Block Steakhouse
  "venue-pzbwmw": ["burger", "kitchen"], // Cask Pub & Kitchen
  "venue-1226a9v": ["gastropub", "kitchen"], // Brewhouse & Kitchen Highbury
  "venue-1ie3w8u": ["grill"], // North Pole Bar and Grill
  "venue-11n82fd": ["burger"], // The Seven Stars
  "venue-1u2v4eh": ["burger"], // The Waterloo Tap
  "venue-16s3et4": ["burger"], // The Jolly Gardeners
  "venue-1y5lg8a": ["pie"], // The Lord Napier Star
  "venue-7g6jxt": ["pie"], // The New Fairlop Oak
  "venue-we3mzn": ["kitchen"], // German Gymnasium
  "venue-5zogu6": ["kitchen"], // Hicce Hart
  // Wave F1 — denser food coverage on central crawl pubs (still light tags).
  "venue-1yd70c7": ["gastropub", "roast"], // The Lamb
  "venue-fr71bp": ["gastropub", "roast"], // Museum Tavern
  "venue-gv8lwa": ["gastropub", "fish"], // Anchor Bankside
  "venue-1x50b6d": ["gastropub"], // Old Thameside Inn
  "venue-16pnwmm": ["gastropub", "fish"], // Prospect of Whitby
  "venue-ekvkuv": ["gastropub"], // The Grapes
  "venue-1d8a5xb": ["gastropub"], // Captain Kidd
  "venue-fpmfjs": ["gastropub"], // The Rake
  "venue-133uf6h": ["gastropub", "kitchen"], // Katzenjammers
  "venue-dbukrn": ["gastropub", "pie"], // The Coal Hole
  "venue-lrlyh8": ["gastropub", "roast"], // Old Bank of England
  "venue-1sx1vco": ["gastropub"], // Ye Olde Cock Tavern
  "venue-erabed": ["gastropub", "pizza"], // The Perseverance
  // Wave G — pizza coverage (real menu signals from descriptions).
  "venue-nm6egd": ["pizza"], // The Horse & Wig (Roman-style pizzas)
  "venue-1mjowpj": ["pizza"], // The Regent (pizzas, pints and cocktails)
  "venue-1dohqsq": ["pizza"], // The White Bear (artisan sourdough pizzas)
  "venue-11nrwqy": ["pizza"], // Canova Hall (wood-fired pizzas)
  "venue-yhodj6": ["pizza"], // The Alexandra (pizzas and craft beers)
  "venue-18cp9b2": ["pizza"], // The Lido Cafe / 400 Rabbits (pizza restaurant)
  "venue-133en5b": ["pizza", "kitchen"], // The Chequers (pizzas from their kitchen)
  "venue-ejcaqb": ["pizza", "burger"], // The Merchant of Battersea (pizzas + burgers)
  "venue-5f6v63": ["pizza"], // The Ship (homemade sourdough pizzas)
  "venue-j6qgni": ["pizza", "roast"], // The George & Monkey (pizza + Sunday roast)
  "venue-avls5f": ["pizza"], // Teatro Hall (pizza and bar)
  "venue-16co4ye": ["pizza", "burger"], // Royal Sovereign (pizza + burgers)
  "venue-wroxba": ["pizza"], // The Railway Tavern (pizza menu)
  "venue-qkjsbo": ["pizza"], // The Dog & Duck Chingford (pizza menu)
  "venue-1o8k9q5": ["pizza", "kitchen"], // The Mitre Richmond (voted best pizza)
  "venue-7q2zlv": ["pizza"], // The Richmal Crompton — JD Wetherspoon (pizza menu)
  // Wave G — burger coverage.
  "venue-1jdhzak": ["burger"], // The Camel & Artichoke (handmade SMASH burgers)
  "venue-gjzd9u": ["burger", "pie"], // The Duke of York (burgers + pies)
  "venue-7rb0oo": ["burger"], // The Queens Head Shoreditch (indulgent burgers)
  "venue-cgh71l": ["burger", "roast"], // The Alma N1 (burgers + Sunday roasts)
  "venue-oyallt": ["burger", "roast"], // The Alma Newington Green (burgers to Sunday roasts)
  "venue-dmtau6": ["burger", "roast", "fish"], // Goat Tavern Kensington (burgers + roast + fish)
  "venue-ztnnz3": ["burger", "pie"], // The Feathers Westminster (burgers + pies)
  "venue-tfd2th": ["burger", "steak"], // The Guildford Arms (burgers + steak)
  "venue-1ntd4m": ["burger"], // The Star by Liverpool Street (Chuck Burger menu)
  "venue-1s4m5bc": ["burger"], // The Prince Edward Bayswater (burger menu)
  // Wave G — roast coverage.
  "venue-3kkk8e": ["roast", "gastropub"], // Camden Head (Grade II, Sunday roast)
  "venue-xm0ya3": ["roast", "gastropub"], // Masons Arms Mayfair (roast since 1721)
  "venue-10jw1vr": ["roast", "gastropub"], // The George Southwark (galleried inn, roasts)
  // Wave G — gastropub coverage.
  "venue-19rlplo": ["roast", "gastropub"], // The Cavendish (independent gastropub)
  "venue-1u69mia": ["roast", "gastropub"], // The Junction Angel (modern British)
  "venue-1tmrglv": ["gastropub"], // The Havelock Tavern (one of city's original gastropubs)
  "venue-ywzy0i": ["gastropub"], // The Phoenix Clapham (vibrant gastropub)
  "venue-i4knvc": ["gastropub", "italian"], // The Swan Chiswick (Mediterranean gastropub)
  "venue-xn9vmg": ["gastropub"], // The Chesterfield Arms Mayfair (gastropub)
  // Wave G — tapas + thai coverage.
  "venue-dmli42": ["roast", "tapas"], // The Dean Swift (tapas + Sunday roast)
  "venue-1khsihb": ["tapas"], // The Duke of Sussex (tapas menu)
  "venue-15m19g8": ["thai"], // The Latymers Hammersmith (Thai food menu)
  "venue-hoo8sl": ["thai"], // Hop Pole Wandsworth (Thai food)
  "venue-11iolkd": ["thai"], // The Lemon Tree Covent Garden (Thai kitchen)
  "venue-tc77u2": ["thai"], // Hardy's Freehouse Greenwich (Thai food)
  "venue-1yylwyg": ["thai"], // The Old Pack Horse Chiswick (Thai menu)
};

/** Normalise a raw tag: trim, lowercase, drop empties / unknowns. */
export function normaliseCuisineTag(raw: string): string | null {
  const tag = raw.trim().toLowerCase();
  if (!tag || !KNOWN_SET.has(tag)) return null;
  return tag;
}

/** Dedupe + keep only known tags, stable order matching KNOWN_CUISINE_TAGS. */
export function normaliseCuisineTags(tags: readonly string[] | null | undefined): string[] {
  if (!tags || tags.length === 0) return [];
  const found = new Set<string>();
  for (const raw of tags) {
    const tag = normaliseCuisineTag(raw);
    if (tag) found.add(tag);
  }
  return KNOWN_CUISINE_TAGS.filter((tag) => found.has(tag));
}

/** Pull known cuisine keywords out of free text (name / searchText). */
export function cuisineTagsFromText(text: string | null | undefined): string[] {
  if (!text) return [];
  const lower = text.toLowerCase();
  return KNOWN_CUISINE_TAGS.filter((tag) => {
    // Word-ish match: tag as whole word, hyphenated compound, or common plural (e.g. "pizzas", "burgers").
    const re = new RegExp(`(?:^|[^a-z])${tag}s?(?:[^a-z]|$)`);
    return re.test(lower);
  });
}

export type CuisineLookupInput = {
  id: string;
  name?: string;
  searchText?: string;
  /** Optional tags already on VenueFilterHints.cuisineTags. */
  hintTags?: readonly string[];
};

/**
 * Resolve soft cuisine tags for a venue: curated id map ∪ hint tags ∪
 * keyword hits in name/searchText. Always returns a normalised, deduped list.
 */
export function cuisineTagsForVenue(input: CuisineLookupInput): string[] {
  const curated = CURATED_CUISINE_BY_VENUE_ID[input.id] ?? [];
  const fromHints = input.hintTags ?? [];
  const fromText = cuisineTagsFromText(
    [input.name, input.searchText].filter(Boolean).join(" "),
  );
  return normaliseCuisineTags([...curated, ...fromHints, ...fromText]);
}
