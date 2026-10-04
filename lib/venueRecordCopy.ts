import { LONDON_BOROUGH_NAMES } from "./londonBoroughNames.mjs";
import type { Venue } from "./venues";

export type VenueRecordCopy = { description: string; vibeTags: string[] };
export type VenueCopyChoices = {
  venueId: string;
  sentences: string[];
  vibeTags: string[];
};

// These are factual labels, never an inference about atmosphere or clientele.
const AMENITY_COPY = [
  ["food", "Serves food.", "Food served"],
  ["cocktails", "Serves cocktails.", "Cocktails"],
  ["beerGarden", "Has a beer garden.", "Beer garden"],
  ["liveSports", "Shows live sport.", "Live sport"],
  ["nonAlcoholic", "Has alcohol-free options.", "Alcohol-free options"],
  ["liveMusic", "Has live music.", "Live music"],
  ["pubQuiz", "Runs a pub quiz.", "Pub quiz"],
  ["darts", "Has darts.", "Darts"],
  ["pool", "Has a pool table.", "Pool"],
  ["happyHour", "Has a happy hour.", "Happy hour"],
  ["karaoke", "Has karaoke.", "Karaoke"],
] as const;

/** Model input excludes prose, prices, hours, URLs and external-provider fields. */
export function copyChoicesForVenue(venue: Venue): VenueCopyChoices | null {
  if (venue.kind && venue.kind !== "pub") return null;
  const borough = LONDON_BOROUGH_NAMES.includes(venue.primaryBorough);
  const sentences = [borough ? `Pub in ${venue.primaryBorough}.` : "Pub."];
  const vibeTags = ["Pub"];
  for (const [key, sentence, tag] of AMENITY_COPY) {
    // Unknown is not positive. On public DTOs the three-state contract wins.
    const stated = venue.amenityStatus
      ? venue.amenityStatus[key] === "known-true"
      : venue.amenities[key] === true;
    if (stated) {
      sentences.push(sentence);
      vibeTags.push(tag);
    }
  }
  return { venueId: venue.id, sentences, vibeTags };
}

/** Only exact offered sentences/tags can reach a drinker. Unknown facts fail closed. */
export function validateVenueRecordCopy(
  choices: VenueCopyChoices | null,
  value: unknown,
): VenueRecordCopy | null {
  if (!choices || !value || typeof value !== "object" || Array.isArray(value)) return null;
  const entry = value as Record<string, unknown>;
  if (entry.venueId !== choices.venueId) return null;
  const sentences = entry.sentences;
  const tags = entry.vibeTags;
  if (!Array.isArray(sentences) || !Array.isArray(tags)) return null;
  if (sentences.length < 1 || sentences.length > 3 || tags.length < 1 || tags.length > 3) return null;
  if (new Set(sentences).size !== sentences.length || new Set(tags).size !== tags.length) return null;
  if (sentences[0] !== choices.sentences[0]) return null;
  if (!sentences.every((s) => typeof s === "string" && choices.sentences.includes(s))) return null;
  if (!tags.every((t) => typeof t === "string" && choices.vibeTags.includes(t))) return null;
  const description = sentences.join(" ");
  if (description.length > 200) return null;
  return { description, vibeTags: tags as string[] };
}
