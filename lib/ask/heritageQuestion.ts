import { wordsOnly } from "@/lib/ask/placePhrases";
import { semanticAskRequest } from "@/lib/ask/requestPolicy";
import type { VenueNameMatchInput } from "@/lib/ask/venueResolution";
import { venueSearchNames } from "@/lib/venueSearchNames.mjs";

/** The reader names a pub that several listed pubs share. */
export const HERITAGE_AMBIGUOUS_PUB_HINT =
  "I cannot tell which pub you mean. Choose the pub on the map, then ask about its history.";

/** Preserve the complete requested name so a longer namesake cannot become a listed pub. */
export function heritageQuestionVenueName(query: string): string | null {
  const question = semanticAskRequest(query, false).trim().replace(/[.!?]+$/, "").trim();
  const patterns = [
    /^heritage\s+story\s+for\s+(.+)$/i,
    /^(?:(?:please\s+)?tell me(?:\s+about)?\s+|what(?:'s|\s+is)\s+)?(?:the\s+)?(?:history|heritage|story)\s+(?:of|behind)\s+(.+)$/i,
    /^(?:please\s+)?tell me about\s+(.+)$/i,
    /^when was\s+(.+?)\s+(?:built|opened|founded|established)$/i,
    /^who\s+(?:built|opened|founded)\s+(.+)$/i,
    /^(.+?)(?:'s|’s)?\s+(?:history|heritage)$/i,
  ];
  for (const pattern of patterns) {
    const name = question.match(pattern)?.[1]?.trim();
    if (name) return name;
  }
  return null;
}

/** Match whole names and recorded aliases, with an optional leading article. */
export function heritageVenueNameMatches<T extends VenueNameMatchInput>(venues: readonly T[], name: string): T[] {
  const normalize = (value: string) => wordsOnly(value).replace(/^the\s+/, "");
  const subject = normalize(name);
  if (!subject) return [];
  return venues.filter((venue) => venueSearchNames(venue).some((alias) => normalize(alias) === subject));
}

export function heritageQuestionVenueMatches<T extends VenueNameMatchInput>(venues: readonly T[], query: string): T[] {
  const subject = heritageQuestionVenueName(query);
  if (!subject) return [];
  const matchSubjects = (name: string): T[] => {
    const exact = heritageVenueNameMatches(venues, name);
    if (exact.length) return exact;
    for (const separator of name.matchAll(/\s+(?:and|&)\s+/gi)) {
      const left = heritageVenueNameMatches(venues, name.slice(0, separator.index));
      if (!left.length) continue;
      const right = matchSubjects(name.slice(separator.index + separator[0].length));
      if (right.length) return [...left, ...right];
    }
    return [];
  };
  return matchSubjects(subject);
}
