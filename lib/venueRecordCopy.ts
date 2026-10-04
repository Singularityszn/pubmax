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
// also prints uses the chip's words. `words` may state the fact; `marks` name it.
const AMENITY_COPY = [
  { key: "cocktails", tag: "Cocktails", words: ["cocktail", "cocktails", "drinks"], marks: ["cocktail", "cocktails"] },
  { key: "nonAlcoholic", tag: "Alcohol-free options", words: ["alcohol-free", "options", "drinks"], marks: ["alcohol-free"] },
  { key: "liveMusic", tag: "Live music", words: ["live", "music"], marks: ["music"] },
  { key: "pubQuiz", tag: "Pub quiz", words: ["quiz", "quizzes"], marks: ["quiz", "quizzes"] },
  { key: "darts", tag: "Darts", words: ["darts", "dartboard"], marks: ["darts", "dartboard"] },
  { key: "pool", tag: "Pool", words: ["pool", "table"], marks: ["pool"] },
  { key: "happyHour", tag: "Happy hour", words: ["happy", "hour", "drinks"], marks: ["happy"] },
  { key: "karaoke", tag: "Karaoke", words: ["karaoke"], marks: ["karaoke"] },
] as const;

/** Words that state no fact. Adjectives about mood, age or clientele are absent on purpose. */
export const COPY_CONNECTIVE_WORDS = Object.freeze([
  "a", "an", "the", "and", "or", "with", "plus", "also", "too", "as", "well", "both", "in",
  "of", "on", "at", "for", "to", "out", "this", "it", "its", "is", "has", "does", "runs",
  "hosts", "where", "you", "can", "get", "play", "sing", "catch", "pub", "local",
  "borough",
]);

const SENTENCE = /^[A-Z][A-Za-z ,-]*\.$/;

/** The words that may state one supported tag. */
export function copyWordsForTag(tag: string): readonly string[] {
  return AMENITY_COPY.find((fact) => fact.tag === tag)?.words ?? [];
}

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

/**
 * Every word of the one-sentence description must state a supported fact or
 * none at all, no fact word may repeat, and it must name the pub and at least
 * one supported fact. A pub with no supported fact gets no copy. Unknown facts
 * fail closed.
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
  if (description.length < 20 || description.length > 140 || !SENTENCE.test(description)) return null;
  // Place names keep their capitals; every other word is lower case unless it opens the sentence.
  const places = new Set(["London", ...(facts.borough ? facts.borough.split(" ") : [])]);
  const factWords = new Set<string>(stated.flatMap((fact) => fact.words));
  const tokens = description.match(/[A-Za-z]+(?:-[A-Za-z]+)*/g) ?? [];
  const plain = (token: string, index: number) => {
    const word = token.toLowerCase();
    const cased = index === 0 ? word[0].toUpperCase() + word.slice(1) : word;
    return (token === word || token === cased) && (COPY_CONNECTIVE_WORDS.includes(word) || factWords.has(word));
  };
  if (!tokens.every((token, index) => places.has(token) || plain(token, index))) return null;
  const words = tokens.map((token) => token.toLowerCase());
  const stating = words.filter((word) => factWords.has(word));
  if (new Set(stating).size !== stating.length) return null;
  if (!stated.some((fact) => fact.marks.some((mark) => words.includes(mark)))) return null;
  // The facts belong to the pub, so the sentence must name it, not only its borough.
  if (!words.some((word, index) => word === "local" || (word === "pub" && !/^quiz/.test(words[index + 1] ?? "")))) return null;
  return { description, vibeTags: vibeTags as string[] };
}
