import { stripOperatorSuffix } from "@/lib/venueOperatorSuffix.mjs";

/**
 * The pub name a reader sees: the dataset's name without an operator suffix
 * ("The Moon on the Hill - JD Wetherspoon" reads "The Moon on the Hill"). The
 * suffix is spelling, not the pub's name (lib/venueOperatorSuffix.mjs owns the
 * pattern). Applied where a loader builds a reader-facing venue, never to the
 * raw row, so ids and grouping keys keep the name the dataset files.
 */
export function displayVenueName(name: string): string {
  return stripOperatorSuffix(name);
}

/**
 * The dataset's own name, kept beside the display name only when the two
 * differ, so identity joins and search ("wetherspoon") still read it. Absent
 * when the names agree, so no payload grows for the common case.
 */
export function venueSourceNameField(name: string): { sourceName?: string } {
  return displayVenueName(name) === name ? {} : { sourceName: name };
}

export type VenueAreaSource = {
  locality?: string | null;
  primaryBorough?: string | null;
};

/** Use neighbourhood locality for readers, with borough as honest fallback. */
export function venueAreaLabel(venue: VenueAreaSource): string {
  const locality = venue.locality?.trim();
  const specificLocality =
    locality && !/^(?:london|greater london)$/i.test(locality) ? locality : null;
  return specificLocality || venue.primaryBorough?.trim() || "London";
}

/** Remove a stray comma-separated "Greater" token from display addresses. */
export function displayVenueAddress(address: string): string {
  return address
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && part.toLowerCase() !== "greater")
    .join(", ");
}
