import { placesOpeningHours, usablePlacesObservation } from "@/lib/placesEnrichment";
import { venueContacts, type Venue } from "@/lib/venues";
import "./venuePlacesDetails.css";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const CONTACT_FIELDS = [["formattedAddress", "address"], ["nationalPhoneNumber", "phone"], ["websiteUri", "website"]] as const;

const checked = (observedAt: string) =>
  new Date(observedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/London" });

/** Copied hours and contacts at any age, each credited with the day Google Places was checked. */
export default function VenuePlacesDetails({ venue, links = false, websiteLink = false }: { venue: Venue; links?: boolean; websiteLink?: boolean }) {
  const record = venue.placesContent;
  const now = new Date();
  const hours = placesOpeningHours(record, now);
  const contacts = venueContacts(venue);
  const phoneHref = links ? contacts.phoneHref : null;
  const websiteHref = links && websiteLink ? contacts.websiteHref : null;
  const copied = CONTACT_FIELDS.flatMap(([field, label]) => {
    const observation = record?.[field];
    return usablePlacesObservation(observation, now) ? [{ label, observedAt: observation.observedAt }] : [];
  });
  if (!hours && !phoneHref && !websiteHref && !copied.length) return null;
  const names = copied.map((row) => row.label);
  const list = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0];
  return (
    <div className="venuePlacesDetails">
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
        <small>Google Places · Checked {checked(record!.regularOpeningHours!.observedAt)}</small>
      </details> : null}
    </div>
  );
}
