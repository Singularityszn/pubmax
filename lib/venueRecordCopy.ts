import { LONDON_BOROUGH_NAMES } from "./londonBoroughNames.mjs";
import type { Venue } from "./venues";

export type VenueRecordCopy = { description: string; vibeTags: string[] };
/** The stored facts one pub's copy may state, and nothing else. */
export type VenueCopyFacts = {
  venueId: string;
  borough: string | null;
  supportedTags: string[];
};

// Food, live sport and beer garden are left to the Overview chips. A tag a chip
// also prints uses the chip's words. `terms` are every way prose may name the
// feature; naming one the pub's stored fields do not support fails.
const AMENITY_COPY = [
  { key: "cocktails", tag: "Cocktails", terms: /\bcocktails?\b/g },
  { key: "nonAlcoholic", tag: "Alcohol-free options", terms: /\b(?:alcohol-free|non-alcoholic|low-alcohol|zero-alcohol)\b(?: (?:options|drinks|beers?|pints?))?/g },
  { key: "liveMusic", tag: "Live music", terms: /\blive (?:music|bands?|acts?|sets?)\b|\b(?:bands?|gigs?|musicians?)\b/g },
  { key: "pubQuiz", tag: "Pub quiz", terms: /\b(?:pub )?(?:quiz(?:zes)?|trivia)(?: nights?)?\b/g },
  { key: "darts", tag: "Darts", terms: /\b(?:darts|dartboards?|oche)\b/g },
  { key: "pool", tag: "Pool", terms: /\bpool(?: tables?| cues?)?\b/g },
  { key: "happyHour", tag: "Happy hour", terms: /\bhappy hours?\b/g },
  { key: "karaoke", tag: "Karaoke", terms: /\b(?:karaoke|sing-?alongs?)\b/g },
] as const;
type AmenityKey = (typeof AMENITY_COPY)[number]["key"];

// Features no stored summary fact supports, including the three the Overview
// chips already show. Naming any of them is an unsupported claim.
const UNSUPPORTED_FEATURES = new RegExp(`\\b(?:${[
  "food", "foodie", "kitchen", "menus?", "meals?", "dining", "dinners?", "lunch(?:es)?", "brunch", "breakfasts?",
  "roasts?", "burgers?", "pizzas?", "chips", "snacks?", "grub", "eats", "plates?", "pies?", "curr(?:y|ies)",
  "beer gardens?", "gardens?", "terraces?", "patios?", "rooftops?", "roof", "outdoors?", "outside", "al fresco",
  "sports?", "football", "rugby", "cricket", "tennis", "boxing", "f1", "matches", "match", "screens?", "tvs?",
  "televisions?", "big games?", "wi-?fi", "dogs?", "dog-friendly", "pets?", "fireplaces?", "open fires?", "real ales?",
  "ales?", "cask", "craft", "ipas?", "wines?", "gins?", "whiske?ys?", "rums?", "spirits", "ciders?", "stouts?",
  "guest beers?", "jukebox(?:es)?", "djs?", "dj sets?", "dancing", "dance ?floors?", "discos?", "comedy", "open mics?",
  "bingo", "board games?", "arcades?", "snooker", "billiards", "skittles", "shuffleboard", "ping pong",
  "table tennis", "function rooms?", "private hire", "events?", "parking", "rooms?", "accommodation", "cinema",
  "theatre", "jazz", "folk", "blues", "acoustic", "reggae", "indie", "punk", "metal",
].join("|")})\\b`);

// Mood, quality, reputation, crowd, age, price, quantity and schedule claims no
// stored field can back, plus words that deny a feature or say it has ended. A lone "happy" or "live" is a mood word.
const UNVERIFIABLE = new RegExp(`\\b(?:${[
  "no", "not", "never", "none", "nor", "without", "lacks?", "lacking", "out of", "minus", "except", "isn't", "aren't",
  "doesn't", "don't", "won't", "can't", "cannot", "hasn't", "haven't", "nothing", "forget", "skip",
  "happy(?! hours?)", "live(?! (?:music|bands?|acts?|sets?))", "lively", "cosy", "cozy", "buzz(?:y|ing)?", "vibe",
  "vibes", "atmosphere", "atmospheric", "friendly", "welcoming", "warm", "charming", "charm", "character",
  "historic", "history", "heritage", "traditional", "old", "oldest", "older", "ancient", "classic", "iconic",
  "famous", "legendary", "landmark", "institution", "popular", "favourites?", "favorites?", "beloved", "loved",
  "best", "better", "great", "good", "nice", "decent", "solid", "proper", "top", "perfect", "ideal", "amazing",
  "excellent", "fantastic", "brilliant", "lovely", "superb", "stunning", "beautiful", "gorgeous", "quiet",
  "busy", "packed", "rowdy", "chilled", "relaxed", "laid-back", "intimate", "spacious", "huge", "big", "tiny",
  "small", "little", "large", "stylish", "trendy", "hip", "cool", "fun", "unique", "quirky", "hidden", "gems?",
  "secret", "rustic", "vibrant", "experience", "discover", "elevate", "seamless", "curated", "unleash", "unlock",
  "journey", "effortless", "immerse", "boasts?", "locals", "regulars", "crowds?", "punters", "everyone", "families",
  "family", "students", "workers", "tourists", "award", "award-winning", "cheap", "cheapest", "affordable",
  "pricey", "expensive", "prices?", "priced", "value", "bargains?", "deals?", "discounts?", "quid", "budget",
  "wallet", "free", "every", "weekly", "nightly", "daily", "tonight", "today", "weekends?", "mornings?",
  "afternoons?", "evenings?", "nights", "late", "open", "opens", "until", "always", "often", "usually", "what a",
  "known", "renowned", "reputation", "speciali[sz](?:e|es|ed|ing)", "special(?:i?ty|ities)", "signature",
  "once", "used to", "formerly", "former", "gone", "dropped", "stopped", "ended", "banned", "ditched", "closed",
  "rubbish", "dreadful", "terrible", "awful", "bad", "worst", "poor", "overpriced", "range of", "selection of",
  "variety of", "plenty", "lots", "loads",
].join("|")})\\b`);

// Each verb may govern only the features it fits: nobody catches a cocktail.
const VERB_FITS: ReadonlyArray<[RegExp, readonly AmenityKey[]]> = [
  [/^(?:catch|catching|host|hosts|hosting|run|runs|running|puts on|put on|stages?)$/, ["liveMusic", "pubQuiz", "karaoke"]],
  [/^(?:play|plays|playing|shoot|throw|throws)$/, ["darts", "pool"]],
  [/^(?:sing|sings|singing|belt|belts)$/, ["karaoke"]],
  [/^(?:join|joins|joining|enter|enters|take part in)$/, ["pubQuiz", "karaoke"]],
  [/^(?:get|gets|grab|grabs|order|orders|sip|sips)$/, ["cocktails", "nonAlcoholic", "happyHour"]],
  [/^(?:serve|serves|serving|pour|pours|pouring|mix|mixes|mixing|shake|shakes|shaking)$/, ["cocktails", "nonAlcoholic"]],
  [/^(?:has|have|offers?|offering|does|do)$/, AMENITY_COPY.map(({ key }) => key)],
];
const VERBS = /\b(?:catch|catching|host|hosts|hosting|run|runs|running|puts on|put on|stages?|play|plays|playing|shoot|throw|throws|sing|sings|singing|belt|belts|join|joins|joining|enter|enters|take part in|get|gets|grab|grabs|order|orders|sip|sips|serve|serves|serving|pour|pours|pouring|mix|mixes|mixing|shake|shakes|shaking|has|have|offers?|offering|does|do)\b/g;

const FORMAT = /^[A-Z][A-Za-z ,.?'’-]*\.$/;
const PUB_REFERENCE = /\b(?:pub(?! quiz)|local|boozer|place|spot|venue|here|they)\b/i;

/** Model input excludes names, prose, prices, hours, URLs and external-provider fields. */
export function copyFactsForVenue(venue: Venue): VenueCopyFacts | null {
  if (venue.kind && venue.kind !== "pub") return null;
  const supportedTags = AMENITY_COPY.filter(({ key }) =>
    // Unknown is not positive. On public DTOs the three-state contract wins.
    venue.amenityStatus ? venue.amenityStatus[key] === "known-true" : venue.amenities[key] === true,
  ).map(({ tag }) => tag);
  const borough = LONDON_BOROUGH_NAMES.includes(venue.primaryBorough) ? venue.primaryBorough : null;
  return { venueId: venue.id, borough, supportedTags };
}

/** Proper nouns are named claims: only the borough and London, never leading a sentence. */
function placesFollowThePub(description: string, borough: string | null): boolean {
  const places = [borough, "London"].filter((place): place is string => Boolean(place));
  let named = description;
  for (const place of places) named = named.split(place).join(" ");
  if (/(?<![.?] |^)\b[A-Z]/.test(named)) return false;
  const sentences = description.split(/(?<=[.?]) /);
  if (!sentences.some((sentence) => PUB_REFERENCE.test(sentence))) return false;
  for (const sentence of sentences) {
    const firstPub = sentence.search(PUB_REFERENCE);
    const limit = firstPub < 0 ? sentence.length : firstPub;
    for (const place of places) {
      for (let at = sentence.indexOf(place); at >= 0 && at < limit; at = sentence.indexOf(place, at + 1)) {
        if (!/^ (?:pub|local|boozer|place|spot|venue)\b/.test(sentence.slice(at + place.length))) return false;
      }
    }
  }
  return !places.some((place) => new RegExp(`\\bthe ${place}`, "i").test(description));
}

/** Every named feature is supported, named once, never denied and paired with a verb that fits. */
function claimsAreSupported(description: string, stated: ReadonlyArray<(typeof AMENITY_COPY)[number]>): boolean {
  let text = description.toLowerCase().replace(/’/g, "'");
  const mentioned: AmenityKey[] = [];
  for (const { key, terms } of AMENITY_COPY) {
    text = text.replace(terms, () => {
      mentioned.push(key);
      return ` fact_${key} `;
    });
  }
  if (mentioned.length === 0 || new Set(mentioned).size !== mentioned.length) return false;
  if (!mentioned.every((key) => stated.some((fact) => fact.key === key))) return false;
  if (UNSUPPORTED_FEATURES.test(text) || UNVERIFIABLE.test(text)) return false;
  if (/fact_\w+ +with\b|\band drinks\b|\bfor you to\b/.test(text)) return false;
  // A pub hosts and serves; people catch, play, sing and get.
  if (/\b(?:pub|local|boozer|place|spot|venue|it|they) (?:catch|catches|play|plays|sing|sings|get|gets|grab|grabs|order|orders|sip|sips)\b/.test(text)) return false;
  return text.split(/[.?;:]/).every((clause) => {
    const verbs = [...clause.matchAll(VERBS)];
    return verbs.every((verb, index) => {
      const end = verbs[index + 1]?.index ?? clause.length;
      const governed = [...clause.slice(verb.index, end).matchAll(/fact_(\w+)/g)].map((match) => match[1]);
      const fits: readonly string[] = VERB_FITS.find(([pattern]) => pattern.test(verb[0]))?.[1] ?? [];
      return governed.every((key) => fits.includes(key));
    });
  });
}

/**
 * Free prose is checked for its claims, not its wording. It may name only the
 * pub's supported features, each once and with a verb that fits, and must
 * deny none. It makes no mood, quality, crowd, price or schedule claim and
 * names no person, brand or place but the pub's borough and London. The pub is
 * the subject and the sentence never leads with its borough. A pub with no
 * supported fact gets no copy. Unknown facts fail closed.
 */
export function validateVenueRecordCopy(
  facts: VenueCopyFacts | null,
  value: unknown,
): VenueRecordCopy | null {
  if (!facts || !value || typeof value !== "object" || Array.isArray(value)) return null;
  const entry = value as Record<string, unknown>;
  const { description, vibeTags } = entry;
  if (entry.venueId !== facts.venueId || typeof description !== "string" || !Array.isArray(vibeTags)) return null;
  const stated = AMENITY_COPY.filter(({ tag }) => facts.supportedTags.includes(tag));
  if (stated.length === 0) return null;
  if (vibeTags.length < 1 || vibeTags.length > 3 || new Set(vibeTags).size !== vibeTags.length) return null;
  if (!vibeTags.every((tag) => stated.some((fact) => fact.tag === tag))) return null;
  if (description.length < 20 || description.length > 180 || !FORMAT.test(description)) return null;
  if ((description.match(/[.?](?: |$)/g) ?? []).length > 2) return null;

  if (!placesFollowThePub(description, facts.borough) || !claimsAreSupported(description, stated)) return null;
  return { description, vibeTags: vibeTags as string[] };
}
