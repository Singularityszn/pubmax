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
// also prints uses the chip's words. Recognised feature terms are checked here;
// a separate Gemini grounding judge checks every claim before publication.
const AMENITY_COPY = [
  { key: "cocktails", tag: "Cocktails", terms: /\bcocktails?\b/g },
  { key: "nonAlcoholic", tag: "Alcohol-free options", terms: /\b(?:alcohol-free|non-alcoholic|low-alcohol|zero-alcohol)\b(?: (?:options|drinks|beers?|pints?))?/g },
  { key: "liveMusic", tag: "Live music", terms: /\blive (?:music|bands?|acts?|sets?)\b|\b(?:bands?|gigs?|musicians?)\b/g },
  { key: "pubQuiz", tag: "Pub quiz", terms: /\b(?:pub )?(?:quiz(?:zes)?|trivia)(?: nights?)?\b/g },
  { key: "darts", tag: "Darts", terms: /\b(?:darts|dartboards?|oche)\b/g },
  { key: "pool", tag: "Pool", terms: /\bpool(?: table| cue)?\b/g },
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
  "theatre", "jazz", "folk", "blues", "acoustic", "reggae", "indie", "punk", "metal", "tables?",
].join("|")})\\b`);

// Fast rejection heuristics. These lists are not a complete semantic check;
// publication also requires a separate grounding-judge verdict.
const PASSIVE = "(?<!\\b(?:is|are|be|been|being) )";
const SUPERLATIVE_EXCEPTIONS = [
  "rest", "west", "guests?", "test", "interest", "request", "quest", "honest", "nest", "chest", "pest", "suggest",
  "contest", "protest", "invest", "harvest", "forest", "digest", "arrest", "crest", "zest", "manifest", "earnest",
  "conquest", "priest", "vest", "jest", "lest", "attest", "behest", "infest", "detest", "inquest", "bequest",
];
const CLAIM_CLASSES = {
  denial: ["no", "not", "never", "none", "nor", "without", "lacks?", "lacking", "out of", "minus", "except",
    "isn't", "aren't", "doesn't", "don't", "won't", "can't", "cannot", "hasn't", "haven't", "nothing", "forget", "skip"],
  lapse: ["once", "used to", "formerly", "former", "previously", "recently", "lately", "anymore", "any more",
    "gone", "dropped", "stopped", "ended", "banned", "ditched", "closed", "closing", "closes", "shut", "shuts",
    "scrapped", "axed", "cancell?ed", "suspended", "discontinued", "retired", "paused", "halted", "ceased", "quit",
    "lost", "removed", "was", "were",
    `${PASSIVE}(?:hosted|served|ran|poured|played|sang|joined|entered|grabbed|ordered|sipped|mixed|shook|shaken|threw|caught|staged|had|offered|did|featured|held)`],
  hedge: ["might", "may", "maybe", "perhaps", "possibly", "probably", "could", "would", "should", "sometimes",
    "occasional(?:ly)?", "rare(?:ly)?", "seldom", "regular(?:ly)?", "frequent(?:ly)?", "usually", "often",
    "generally", "typically", "mostly", "hardly", "barely", "soon", "tends?", "now and then", "from time to time",
    "every", "always", "weekly", "nightly", "daily"],
  schedule: ["tonight", "today", "tomorrow", "weekends?", "weekdays?", "mornings?", "afternoons?", "evenings?",
    "nights", "late", "early", "open", "opens", "until", "till", "til", "midnight", "noon", "o'clock", "am", "pm",
    "hours?", "days?", "weeks?", "months?", "monthly", "years?", "yearly", "annual(?:ly)?", "seasons?", "seasonal",
    "summer", "winter", "spring", "autumn", "christmas", "during", "twice", "thrice", "times", "fortnight(?:ly)?",
    "(?:mon|tues|wednes|thurs|fri|satur|sun)days?"],
  mood: ["happy(?! hours?)", "live(?! (?:music|bands?|acts?|sets?))", "lively", "cosy", "cozy", "buzz(?:y|ing)?",
    "vibes?", "atmospheric", "atmosphere", "friendly", "welcoming", "warm", "charming", "charm", "character",
    "chilled", "relaxed", "laid-back", "intimate", "rowdy", "quiet", "busy", "packed", "fun", "what a"],
  quality: ["best", "better", "great", "good", "nice", "decent", "solid", "proper", "top", "perfect", "ideal",
    "amazing", "excellent", "fantastic", "brilliant", "lovely", "superb", "stunning", "beautiful", "gorgeous",
    "spacious", "huge", "big", "tiny", "small", "little", "large", "stylish", "trendy", "hip", "cool", "unique",
    "quirky", "hidden", "gems?", "secret", "rustic", "vibrant", "experience", "discover", "elevate", "seamless",
    "curated", "unleash", "unlock", "journey", "effortless", "immerse", "boasts?", "go-to", "excel(?:s|led|lent)?",
    "rubbish", "dreadful", "terrible", "awful", "bad", "worst", "poor", "mediocre", "weak", "strong",
    `(?!(?:${SUPERLATIVE_EXCEPTIONS.join("|")})\\b)[a-z]{2,}est`],
  reputation: ["known", "renowned", "reputation", "speciali[sz](?:e|es|ed|ing)", "special(?:i?ty|ities)",
    "signature", "famous", "legendary", "iconic", "landmark", "institution", "popular", "favourites?",
    "favorites?", "beloved", "loved", "award", "award-winning"],
  age: ["historic", "history", "heritage", "traditional", "old", "older", "ancient", "classic", "new", "newly"],
  crowd: ["locals", "regulars", "crowds?", "punters", "everyone", "families", "family", "students", "workers",
    "tourists"],
  price: ["cheap\\w*", "affordable", "pric\\w*", "expensive", "overpriced", "value", "bargains?", "deals?",
    "discounts?", "quid", "budget", "wallet", "free", "fiver", "tenner", "pounds?", "pence", "costs?", "costing",
    "pay", "paying", "spend"],
  quantity: ["range of", "selection of", "variety of", "plenty", "lots", "loads", "dozens?", "several", "few",
    "many", "multiple", "numerous", "countless", "couple", "pair", "two", "three", "four", "five", "six", "seven",
    "eight", "nine", "ten", "eleven", "twelve", "twenty", "hundreds?", "extensive", "endless"],
};
const UNVERIFIABLE = new RegExp(`\\b(?:${Object.values(CLAIM_CLASSES).flat().join("|")})\\b`);

// The word before a feature may only introduce it: a determiner, a joining
// word, a verb, or "a game of". Any adjective, number or price there is a claim.
const BEFORE_FACT = new Set([
  "a", "an", "the", "some", "its", "their", "your", "and", "or", "plus", "with", "also", "both", "for", "on", "up",
  "in", "find", "fancy", "enjoy", "try", "then", "got", "there's", "here's",
]);
const PARTITIVE = new Set(["game", "bit", "round", "frame", "go"]);
const ALL_FEATURES = AMENITY_COPY.map(({ key }) => key);
const STAGED: readonly AmenityKey[] = ["liveMusic", "pubQuiz", "karaoke"];
const GAMES: readonly AmenityKey[] = ["darts", "pool"];
const DRINKS: readonly AmenityKey[] = ["cocktails", "nonAlcoholic"];
// A passive participle governs the features before it, back to the previous
// verb or the clause start, and must name one there: nobody serves darts.
const PARTICIPLE_FITS: ReadonlyArray<[RegExp, readonly AmenityKey[]]> = [
  [/^(?:served|poured|mixed)$/, DRINKS],
  [/^(?:hosted|run|put)$/, STAGED],
  [/^played$/, [...GAMES, "liveMusic"]],
  [/^sung$/, ["karaoke"]],
];
const PARTICIPLES = /\b(?:served|poured|mixed|hosted|run|put|played|sung)\b/g;
const AFTER_BE = /(?:\b(?:is|are|be|been|being)|'s|'re)(?: (?:also|all|both))? *$/;
// After "<features> are" only a presence word or a participle may follow, never a verdict.
const AFTER_FACT_IS = new Set([
  "on", "here", "available", "featured", "offered", "provided", "in", "at", "a", "an", "the", "part",
  "served", "poured", "mixed", "run", "hosted", "put", "played", "sung",
]);
const BE = new Set(["is", "are", "'s", "be", "been", "being"]);
const BETWEEN_BE = new Set(["also", "all", "both", "can"]);
const SUBJECT_LINK = new Set([",", "and", "or", "plus", "both", "a", "an", "the", "some", "its", "their"]);

// Each verb may govern only the features it fits: nobody catches a cocktail.
const VERB_FITS: ReadonlyArray<[RegExp, readonly AmenityKey[]]> = [
  [/^(?:catch|catching|host|hosts|hosting|run|runs|running|puts on|put on|stages?)$/, STAGED],
  [/^(?:play|plays|playing|shoot|throw|throws)$/, GAMES],
  [/^(?:sing|sings|singing|belt|belts)$/, ["karaoke"]],
  [/^(?:join|joins|joining|enter|enters|take part in)$/, ["pubQuiz", "karaoke"]],
  [/^(?:get|gets|grab|grabs|order|orders|sip|sips)$/, [...DRINKS, "happyHour"]],
  [/^(?:serve|serves|serving|pour|pours|pouring|mix|mixes|mixing|shake|shakes|shaking)$/, DRINKS],
  [/^(?:has|have|offers?|offering|does|do|features?|featuring|provides?|providing)$/, ALL_FEATURES],
];
const VERBS = /\b(?:catch|catching|host|hosts|hosting|run|runs|running|puts on|put on|stages?|play|plays|playing|shoot|throw|throws|sing|sings|singing|belt|belts|join|joins|joining|enter|enters|take part in|get|gets|grab|grabs|order|orders|sip|sips|serve|serves|serving|pour|pours|pouring|mix|mixes|mixing|shake|shakes|shaking|has|have|offers?|offering|does|do|features?|featuring|provides?|providing)\b/g;

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
function claimsAreSupported(
  description: string,
  borough: string | null,
  stated: ReadonlyArray<(typeof AMENITY_COPY)[number]>,
): boolean {
  let text = description.toLowerCase().replace(/’/g, "'");
  for (const place of [borough, "London"]) if (place) text = text.split(place.toLowerCase()).join(" place ");
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
  if (!factsStandPlain(text)) return false;
  // A pub hosts and serves; people catch, play, sing and get.
  if (/\b(?:pub|local|boozer|place|spot|venue|it|they) (?:catch|catches|play|plays|sing|sings|get|gets|grab|grabs|order|orders|sip|sips)\b/.test(text)) return false;
  return text.split(/[.?;:]/).every((clause) => {
    const verbs = [...clause.matchAll(VERBS)];
    const participles = [...clause.matchAll(PARTICIPLES)].filter((participle) =>
      AFTER_BE.test(clause.slice(0, participle.index)));
    const governing = [...verbs, ...participles].sort((a, b) => a.index - b.index);
    const factsBetween = (start: number, end: number) =>
      [...clause.slice(start, end).matchAll(/fact_(\w+)/g)].map((match) => match[1] ?? "");
    const activeFit = verbs.every((verb) => {
      const end = governing.find((next) => next.index > verb.index)?.index ?? clause.length;
      const fits: readonly string[] = VERB_FITS.find(([pattern]) => pattern.test(verb[0]))?.[1] ?? [];
      return factsBetween(verb.index, end).every((key) => fits.includes(key));
    });
    return activeFit && participles.every((participle) => {
      const previous = governing.filter((verb) => verb.index < participle.index).at(-1);
      const governed = factsBetween(previous ? previous.index + previous[0].length : 0, participle.index);
      const fits: readonly string[] = PARTICIPLE_FITS.find(([pattern]) => pattern.test(participle[0]))?.[1] ?? [];
      return governed.length > 0 && governed.every((key) => fits.includes(key));
    });
  });
}

/** No modifier before a feature and no verdict after it. */
function factsStandPlain(text: string): boolean {
  const tokens = text.match(/fact_\w+|[a-z'-]+|[,?.;:]/g) ?? [];
  const introduced = tokens.every((token, index) => {
    if (!token.startsWith("fact_")) return true;
    const before = tokens[index - 1];
    if (!before || /^[,?.;:]$/.test(before) || BEFORE_FACT.has(before)) return true;
    if (VERB_FITS.some(([pattern]) => pattern.test(before))) return true;
    return (before === "of" || before === "at") && PARTITIVE.has(tokens[index - 2] ?? "");
  });
  if (!introduced) return false;
  return tokens.every((token, index) => {
    if (!BE.has(token)) return true;
    const after = tokens.slice(index + 1).find((next) => !BETWEEN_BE.has(next)) ?? "";
    if (BE.has(after)) return true;
    let at = index - 1;
    const tokenAt = (i: number) => tokens[i] ?? "";
    while (at >= 0 && (BE.has(tokenAt(at)) || BETWEEN_BE.has(tokenAt(at)))) at--;
    let featureSubject = false;
    for (; at >= 0 && (tokenAt(at).startsWith("fact_") || SUBJECT_LINK.has(tokenAt(at))); at--) {
      featureSubject ||= tokenAt(at).startsWith("fact_");
    }
    return !featureSubject || AFTER_FACT_IS.has(after);
  });
}

export function validateVenueRecordCopyDraft(
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

  if (!placesFollowThePub(description, facts.borough) || !claimsAreSupported(description, facts.borough, stated)) return null;
  return { description, vibeTags: vibeTags as string[] };
}

/** Published copy must carry a supported judge verdict bound to this exact draft and fact snapshot. */
export function validateVenueRecordCopy(facts: VenueCopyFacts | null, value: unknown): VenueRecordCopy | null {
  const copy = validateVenueRecordCopyDraft(facts, value);
  if (!copy || !facts) return null;
  const entry = value as Record<string, unknown>;
  if (entry.borough !== facts.borough || JSON.stringify(entry.supportedTags) !== JSON.stringify(facts.supportedTags)) return null;
  const grounding = entry.grounding as Record<string, unknown> | undefined;
  if (!grounding || grounding.version !== 2 || grounding.verdict !== "SUPPORTED" ||
      grounding.description !== copy.description || JSON.stringify(grounding.vibeTags) !== JSON.stringify(copy.vibeTags) ||
      !Array.isArray(grounding.claims) || grounding.claims.length === 0) return null;
  const fullText = [copy.description, ...copy.vibeTags].join("\n");
  if (!grounding.claims.every((claim) => claim && typeof claim === "object" &&
      claim.verdict === "SUPPORTED" && typeof claim.phrase === "string" && claim.phrase.trim() &&
      fullText.includes(claim.phrase) && claim.offendingPhrase === "")) return null;
  let uncovered = fullText;
  for (const claim of grounding.claims) uncovered = uncovered.split(claim.phrase).join(" ");
  if (/[A-Za-z]/.test(uncovered)) return null;
  return copy;
}
