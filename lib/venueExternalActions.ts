import type { Venue } from "@/lib/venues";

/**
 * External venue CTAs (Book / Menu / Order) — Greene King–style actions without
 * inventing commerce. Only surfaces real http(s) URLs already on the venue.
 *
 * Food ordering stays link-out only until we have a curated `orderUrl` layer.
 */

export type VenueExternalActionKind = "book" | "menu" | "website" | "order";

export type VenueExternalAction = {
  kind: VenueExternalActionKind;
  label: string;
  href: string;
};

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function firstHttp(...candidates: Array<string | undefined | null>): string {
  for (const candidate of candidates) {
    const trimmed = typeof candidate === "string" ? candidate.trim() : "";
    if (trimmed && isHttpUrl(trimmed)) return trimmed;
  }
  return "";
}

/**
 * Resolve Book / Look at the menu / Pub website CTAs for a venue.
 * Order food is reserved for a future curated order URL (never faked).
 */
export function venueExternalActions(venue: Venue): VenueExternalAction[] {
  const actions: VenueExternalAction[] = [];

  const booking = firstHttp(venue.bookingLink);
  if (booking) {
    actions.push({ kind: "book", label: "Book a table", href: booking });
  }

  const website = firstHttp(venue.website);
  if (website) {
    // Honest label: most dataset websites are pub homepages, not a menu PDF.
    // When the pub serves food, "Look at the menu" is the Greene King–style
    // affordance; otherwise "Pub website".
    actions.push({
      kind: venue.amenities.food ? "menu" : "website",
      label: venue.amenities.food ? "Look at the menu" : "Pub website",
      href: website,
    });
  }

  return actions;
}
