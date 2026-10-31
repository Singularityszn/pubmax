// Crawl name generator (launch review F9): two words from the stops' names and
// the crew's vibe vote. "Victorian Soho" becomes "The Brass Compass".
//
// The name is "The {Adjective} {Noun}":
//   - the adjective comes from a closed list keyed by the plan's vibe vote
//     (lib/vibeChips.ts), so a quiet night never reads as a big one;
//   - the noun is a word lifted from one of the stops' own names (Lamb, Flag,
//     Anchor), never a word this file made up, unless no stop has a usable
//     word, when a closed list of pub-sign nouns stands in;
//   - the plan id seeds both picks, so the same plan always gets the same name;
//   - the result is never a stop's full name (or any name the caller passes in
//     `avoidNames`), never a banned word from docs/VOICE.md, and never a word
//     about drinking (the PUBMAXX Promise: the life around the drink).
//
// Pure: no window, no fetch, no clock and no Math.random.

import type { VibeChipId } from "@/lib/vibeChips";

const ADJECTIVES_BY_VIBE: Record<VibeChipId | "any", readonly string[]> = {
  bender: ["Grand", "Roaring", "Mighty", "Midnight", "Wandering"],
  lit: ["Electric", "Ringing", "Rocking", "Thundering", "Brassy"],
  quiet: ["Quiet", "Gentle", "Hushed", "Lamplit", "Snug"],
  cheeky: ["Cheeky", "Nimble", "Sly", "Brisk", "Artful"],
  match: ["Sporting", "Fearless", "Plucky", "Victorious", "Rowdy"],
  quiz: ["Clever", "Curious", "Learned", "Puzzled", "Wise"],
  date: ["Velvet", "Candlelit", "Gallant", "Tender", "Starlit"],
  any: ["Brass", "Copper", "Victorian", "Crooked", "Merry", "Silver"],
};

/** Pub-sign nouns for a route whose names give no usable word. */
const FALLBACK_NOUNS = ["Compass", "Lantern", "Anchor", "Crown", "Lamb", "Kettle", "Fox", "Bell"] as const;

/** Words in a pub name that say what it is, not what it is called. */
const GENERIC_WORDS = new Set([
  "the", "and", "of", "at", "in", "on", "by", "a", "an", "ye", "olde", "old", "new",
  "pub", "inn", "tavern", "bar", "house", "hotel", "arms", "head", "rooms", "room",
  "tap", "taproom", "kitchen", "dining", "brewery", "brewpub", "lounge", "club",
  "saloon", "alehouse", "wetherspoon", "wetherspoons", "spoons", "london", "street",
  "road", "lane", "st", "saint",
]);

/**
 * Never in a generated name. The docs/VOICE.md hard bans, the night words it
 * rules out ("sesh", "carnage", "session"), and every word that counts or
 * praises a drink.
 */
const BANNED_WORDS = new Set([
  "experience", "discover", "elevate", "seamless", "curated", "unleash", "empower",
  "vibrant", "delve", "journey", "effortless", "immerse", "robust", "leverage",
  "revolutionary", "unlock",
  "sesh", "carnage", "session", "bender", "smashed", "wasted", "hammered", "legless",
  "drunk", "pint", "pints", "lager", "beer", "ale", "ales", "cider", "wine", "gin",
  "vodka", "rum", "whisky", "whiskey", "shot", "shots", "round", "rounds", "booze",
  "boozer", "drink", "drinks", "drinking", "tipsy", "sloshed", "plastered", "bottle",
  "bottles", "keg", "kegs", "barrel", "barrels", "tankard", "tankards", "jug", "jugs",
]);

export type CrawlNameInput = {
  planId: string;
  stopNames: readonly string[];
  /** The crew's leading vibe vote, or null when there is none. */
  vibe?: VibeChipId | null;
  /** Further full names the result must never equal (other real pubs). */
  avoidNames?: readonly string[];
};

/** FNV-1a, 32 bit. Deterministic across runtimes. */
function hash(value: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function titleCase(word: string): string {
  return word.charAt(0).toLocaleUpperCase("en-GB") + word.slice(1).toLocaleLowerCase("en-GB");
}

/** Normalised for comparing names: lower case, letters and spaces, no leading "the". */
function nameKey(name: string): string {
  return name
    .toLocaleLowerCase("en-GB")
    .replace(/[’']/g, "")
    .replace(/[^a-z]+/g, " ")
    .trim()
    .replace(/^the\s+/, "");
}

export function isBannedCrawlNameWord(word: string): boolean {
  return BANNED_WORDS.has(word.toLocaleLowerCase("en-GB"));
}

/** The usable nouns in the stops' names, in route order, each once. */
export function crawlNameNouns(stopNames: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const name of stopNames) {
    for (const raw of name.split(/[^A-Za-z’']+/)) {
      const word = raw.replace(/[’']s$/i, "").replace(/[’']/g, "");
      const lower = word.toLocaleLowerCase("en-GB");
      if (word.length < 3 || GENERIC_WORDS.has(lower) || BANNED_WORDS.has(lower)) continue;
      if (seen.has(lower)) continue;
      seen.add(lower);
      out.push(titleCase(word));
    }
  }
  return out;
}

/**
 * "The {Adjective} {Noun}" for this plan. The same input always returns the
 * same name.
 */
export function generateCrawlName(input: CrawlNameInput): string {
  const adjectives = ADJECTIVES_BY_VIBE[input.vibe ?? "any"] ?? ADJECTIVES_BY_VIBE.any;
  const fromStops = crawlNameNouns(input.stopNames);
  const nouns = fromStops.length > 0 ? fromStops : [...FALLBACK_NOUNS];
  const forbidden = new Set([...input.stopNames, ...(input.avoidNames ?? [])].map(nameKey));
  const seed = hash(input.planId);
  const total = adjectives.length * nouns.length;
  for (let step = 0; step < total; step += 1) {
    const pick = (seed + step) % total;
    const adjective = adjectives[pick % adjectives.length]!;
    const noun = nouns[Math.floor(pick / adjectives.length) % nouns.length]!;
    if (adjective.toLocaleLowerCase("en-GB") === noun.toLocaleLowerCase("en-GB")) continue;
    if (isBannedCrawlNameWord(adjective) || isBannedCrawlNameWord(noun)) continue;
    const name = `The ${adjective} ${noun}`;
    if (forbidden.has(nameKey(name))) continue;
    return name;
  }
  // Every pairing matched a real name: fall back to the closed list, which
  // still never repeats a stop's full name because the adjective differs.
  for (const noun of FALLBACK_NOUNS) {
    const name = `The Wandering ${noun}`;
    if (!forbidden.has(nameKey(name))) return name;
  }
  return "The Wandering Compass";
}
