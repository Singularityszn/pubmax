import { wordsOnly } from "@/lib/ask/placePhrases";
import type { VenueNameMatchInput } from "@/lib/ask/venueResolution";
import { venueSearchNames } from "@/lib/venueSearchNames.mjs";

/** Preserve the complete requested name so a longer namesake cannot become a listed pub. */
export function heritageQuestionVenueName(query: string): string | null {
  const question = query.trim().replace(/[.!?]+$/, "").trim();
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
