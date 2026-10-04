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
// also prints uses the chip's words. A fact is stated only by one of its whole
// phrases, so "happy" or "live" alone is never accepted.
const AMENITY_COPY = [
  { key: "cocktails", tag: "Cocktails", phrases: ["cocktails"] },
  { key: "nonAlcoholic", tag: "Alcohol-free options", phrases: ["alcohol-free options", "alcohol-free drinks"] },
  { key: "liveMusic", tag: "Live music", phrases: ["live music"] },
  { key: "pubQuiz", tag: "Pub quiz", phrases: ["a pub quiz", "a quiz", "pub quizzes", "quizzes"] },
  { key: "darts", tag: "Darts", phrases: ["darts", "a dartboard"] },
  { key: "pool", tag: "Pool", phrases: ["a pool table", "pool"] },
  { key: "happyHour", tag: "Happy hour", phrases: ["a happy hour", "happy hour"] },
  { key: "karaoke", tag: "Karaoke", phrases: ["karaoke"] },
] as const;

/** Words that state no fact. Mood, age, clientele and absence words are absent on purpose. */
export const COPY_CONNECTIVE_WORDS = Object.freeze([
  "a", "an", "and", "or", "with", "plus", "also", "too", "as", "well", "both", "in", "of",
  "on", "at", "this", "it", "its", "is", "has", "does", "runs", "hosts", "where", "you",
  "can", "get", "play", "sing", "catch", "pub", "local",
]);

const SENTENCE = /^[A-Z][A-Za-z ,-]*\.$/;

/** The whole phrases that may state one supported tag. */
export function copyPhrasesForTag(tag: string): readonly string[] {
  return AMENITY_COPY.find((fact) => fact.tag === tag)?.phrases ?? [];
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
 * The one-sentence description is read left to right. Each part must be a
 * whole phrase of a supported fact, the pub's borough or London used directly
 * before "pub" or "local", or a connective that states nothing. No fact may
 * repeat, at least one must be named, and the pub must be the sentence's
 * subject. A pub with no supported fact gets no copy. Unknown facts fail closed.
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

  const tokens = description.match(/[A-Za-z]+(?:-[A-Za-z]+)*/g) ?? [];
  // Place names keep their capitals; every other word is lower case unless it opens the sentence.
  const plain = (index: number) => {
    const word = tokens[index].toLowerCase();
    return tokens[index] === word || (index === 0 && tokens[index] === word[0].toUpperCase() + word.slice(1));
  };
  const places = [facts.borough?.split(" "), ["London"]].filter((place): place is string[] => Boolean(place));
  const phrases = stated.flatMap((fact) => fact.phrases.map((phrase) => ({ tag: fact.tag, words: phrase.split(" ") })))
    .sort((a, b) => b.words.length - a.words.length);
  const at = (index: number, words: readonly string[], cased: boolean) => words.every((word, offset) =>
    index + offset < tokens.length &&
    (cased ? tokens[index + offset] === word : tokens[index + offset].toLowerCase() === word && plain(index + offset)));
  const named = new Set<string>();
  let subject = false;
  for (let index = 0; index < tokens.length;) {
    const place = places.find((words) => at(index, words, true));
    if (place) {
      index += place.length;
      if (!["pub", "local"].includes(tokens[index] ?? "")) return null;
      continue;
    }
    const phrase = phrases.find(({ words }) => at(index, words, false));
    if (phrase) {
      if (named.has(phrase.tag)) return null;
      named.add(phrase.tag);
      index += phrase.words.length;
      continue;
    }
    const word = tokens[index].toLowerCase();
    if (!plain(index) || !COPY_CONNECTIVE_WORDS.includes(word)) return null;
    if (word === "pub" || word === "local") subject = true;
    index += 1;
  }
  if (named.size === 0 || !subject) return null;
  return { description, vibeTags: vibeTags as string[] };
}
