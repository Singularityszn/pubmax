import { placesOpeningHours } from "@/lib/placesEnrichment";
import { venueContacts, type Venue } from "@/lib/venues";
import "./venuePlacesDetails.css";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Display only currently usable hours; the field's own day dates the source credit. */
export default function VenuePlacesDetails({ venue, links = false, websiteLink = false }: { venue: Venue; links?: boolean; websiteLink?: boolean }) {
  const hours = placesOpeningHours(venue.placesContent);
  const contacts = venueContacts(venue);
  if (!hours && (!links || (!contacts.phoneHref && !(websiteLink && contacts.websiteHref)))) return null;
  return (
    <div className="venuePlacesDetails">
      {links ? <div className="venuePlacesDetailsLinks">
        {contacts.phoneHref ? <a href={contacts.phoneHref}>Call {venue.name}</a> : null}
        {websiteLink && contacts.websiteHref ? <a href={contacts.websiteHref} target="_blank" rel="noopener noreferrer">Pub website</a> : null}
      </div> : null}
      {hours ? <details>
        <summary>Opening hours</summary>
        <dl>{[1, 2, 3, 4, 5, 6, 0].map((day) => <div key={day}>
          <dt>{DAYS[day]}</dt>
          <dd>{hours[day]?.length ? hours[day]!.map((window) => `${window.opens} to ${window.closes}`).join(", ") : "Closed"}</dd>
        </div>)}</dl>
        <small>Google Places · Checked {new Date(venue.placesContent!.regularOpeningHours!.observedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/London" })}</small>
      </details> : null}
    </div>
  );
}
