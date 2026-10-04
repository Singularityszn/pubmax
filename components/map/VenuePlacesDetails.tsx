import { Amenity } from "@/components/map/venueInspectorBits";
import { PLACES_PRICE_LABELS, placesOpeningHours, usablePlacesObservation } from "@/lib/placesEnrichment";
import { venueContacts, type Venue } from "@/lib/venues";
import "./venuePlacesDetails.css";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const AMENITY_FIELDS = [
  ["outdoorSeating", "Outdoor seating"], ["servesBeer", "Beer"], ["servesWine", "Wine"],
  ["servesCocktails", "Cocktails"], ["goodForGroups", "Good for groups"], ["liveMusic", "Live music"],
] as const;
const ACCESS_LABELS = {
  wheelchairAccessibleEntrance: "Step-free entry", wheelchairAccessibleRestroom: "Accessible toilet",
  wheelchairAccessibleParking: "Accessible parking", wheelchairAccessibleSeating: "Accessible seating",
} as const;
const CONTACT_FIELDS = [["formattedAddress", "address"], ["nationalPhoneNumber", "phone"], ["websiteUri", "website"]] as const;

const checked = (observedAt: string) =>
  new Date(observedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/London" });

/** Copied hours and contacts at any age, each credited with the day Google Places was checked. Venues without Google Places content render nothing. */
export default function VenuePlacesDetails({ venue, links = false, websiteLink = false }: { venue: Venue; links?: boolean; websiteLink?: boolean }) {
  const record = venue.placesContent;
  if (!record) return null;
  const now = new Date();
  const hours = placesOpeningHours(record, now);
  const contacts = venueContacts(venue);
  const phoneHref = links ? contacts.phoneHref : null;
  const websiteHref = links && websiteLink ? contacts.websiteHref : null;
  const copied = CONTACT_FIELDS.flatMap(([field, label]) => {
    const observation = record[field];
    return usablePlacesObservation(observation, now) ? [{ label, observedAt: observation.observedAt }] : [];
  });
  const rating = usablePlacesObservation(record.rating, now) ? record.rating : null;
  const count = usablePlacesObservation(record.userRatingCount, now) ? record.userRatingCount : null;
  const price = usablePlacesObservation(record.priceLevel, now) ? record.priceLevel : null;
  const summary = usablePlacesObservation(record.editorialSummary, now) ? record.editorialSummary : null;
  const amenities = AMENITY_FIELDS.flatMap(([field, label]) => {
    const observation = record[field];
    return usablePlacesObservation(observation, now) ? [{ label, ...observation }] : [];
  });
  const amenityDates = [...new Set(amenities.map((row) => row.observedAt))];
  const access = usablePlacesObservation(record.accessibilityOptions, now) ? record.accessibilityOptions : null;
  const accessLabels = access ? Object.entries(ACCESS_LABELS).flatMap(([field, label]) =>
    access.value[field as keyof typeof ACCESS_LABELS] === true ? [label] : []) : [];
  if (!hours && !phoneHref && !websiteHref && !copied.length && !rating && !count && !price && !summary && !amenities.length && !accessLabels.length) return null;
  const names = copied.map((row) => row.label);
  const list = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0];
  return (
    <div className="venuePlacesDetails">
      {rating ? <p>Google rating: {rating.value.toFixed(1)} / 5{count?.observedAt === rating.observedAt ? ` · ${count.value.toLocaleString("en-GB")} ratings` : ""}
        <small className="venuePlacesDetailsCredit">Google Places · Checked {checked(rating.observedAt)}</small>
      </p> : null}
      {count && count.observedAt !== rating?.observedAt ? <p>{count.value.toLocaleString("en-GB")} ratings
        <small className="venuePlacesDetailsCredit">Google Places · Checked {checked(count.observedAt)}</small>
      </p> : null}
      {price ? <p>Price level: {PLACES_PRICE_LABELS[price.value]}
        <small className="venuePlacesDetailsCredit">Google Places · Checked {checked(price.observedAt)}</small>
      </p> : null}
      {summary ? <p>{summary.value.text}
        <small className="venuePlacesDetailsCredit">Google Places · Checked {checked(summary.observedAt)}</small>
      </p> : null}
      {amenityDates.map((observedAt) => <div key={observedAt}>
        <div className="amenityRow" aria-label="Google Places amenities">
          {amenities.filter((row) => row.observedAt === observedAt).map(({ label, value }) =>
            <Amenity key={label} label={label} status={value ? "known-true" : "known-false"} />)}
        </div>
        <small className="venuePlacesDetailsCredit">Google Places · Checked {checked(observedAt)}</small>
      </div>)}
      {accessLabels.length ? <div>
        <div className="accessibilityChips" aria-label="Google Places accessibility">
          {accessLabels.map((label) => <span className="accessibilityChip" key={label}>{label}</span>)}
        </div>
        <small className="venuePlacesDetailsCredit">Google Places · Checked {checked(access!.observedAt)}</small>
      </div> : null}
      {phoneHref || websiteHref ? <div className="venuePlacesDetailsLinks">
        {phoneHref ? <a href={phoneHref}>Call {venue.name}</a> : null}
        {websiteHref ? <a href={websiteHref} target="_blank" rel="noopener noreferrer">Pub website</a> : null}
      </div> : null}
      {copied.length ? <small className="venuePlacesDetailsCredit">
        {list.charAt(0).toUpperCase()}{list.slice(1)}: Google Places · Checked {checked(copied[0].observedAt)}
      </small> : null}
      {hours ? <details>
        <summary>Opening hours</summary>
        <dl>{[1, 2, 3, 4, 5, 6, 0].map((day) => <div key={day}>
          <dt>{DAYS[day]}</dt>
          <dd>{hours[day]?.length ? hours[day]!.map((window) => `${window.opens} to ${window.closes}`).join(", ") : "Closed"}</dd>
        </div>)}</dl>
        <small>Google Places · Checked {checked(record.regularOpeningHours!.observedAt)}</small>
      </details> : null}
    </div>
  );
}
