import { firstHttp } from "@/lib/httpUrl";
import { venueContactContract } from "@/lib/venueTruth";
import { venueContacts, type Venue } from "@/lib/venues";
import { usablePlacesObservation, placesOpeningHours, type PlacesEnrichmentRecord } from "@/lib/placesEnrichment";

/** Each field keeps its own date; invalid or future-dated contacts and hours cannot override another source. */
export function applyPlacesEnrichment(venue: Venue, record: PlacesEnrichmentRecord | null | undefined, now = new Date()): Venue {
  if (!record) return venue;
  const existing = venueContacts(venue);
  const address = usablePlacesObservation(record.formattedAddress, now) && typeof record.formattedAddress.value === "string" && record.formattedAddress.value.trim()
    ? record.formattedAddress.value : venue.address;
  const website = usablePlacesObservation(record.websiteUri, now) && typeof record.websiteUri.value === "string"
    ? firstHttp(record.websiteUri.value) || venue.website : venue.website;
  const contacts = venueContactContract({
    phone: usablePlacesObservation(record.nationalPhoneNumber, now) && typeof record.nationalPhoneNumber.value === "string"
      ? record.nationalPhoneNumber.value : existing.phoneNumber,
    website, email: existing.emailHref, bookingLink: existing.bookingHref,
  });
  if (!contacts.phoneNumber) {
    contacts.phoneNumber = existing.phoneNumber;
    contacts.phoneHref = existing.phoneHref;
  }
  const openingHours = placesOpeningHours(record, now);
  return { ...venue, address, website, contacts, placesContent: record,
    ...(openingHours ? { openingHours } : {}),
  };
}
