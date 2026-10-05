import { PLACES_REFRESH_DAYS, placesOpeningHours, usablePlacesObservation } from "@/lib/placesEnrichment";
import type { Venue } from "@/lib/venues";
import "./venuePlacesDetails.css";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const read = (readOn: string) =>
  new Date(`${readOn}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/London" });

/**
 * Dog policy and opening hours the pub's own website states, each credited to
 * that page and the day it was read. Google Places answers first: a fact it
 * already holds is not repeated here, and its hours count only while fresh
 * enough to decide open state. A day the site does not state reads as not
 * stated, never as closed.
 */
export default function VenueSiteDetails({ venue }: { venue: Venue }) {
  const facts = venue.siteFacts;
  if (!facts) return null;
  const now = new Date();
  const dogs = facts.dogs && !usablePlacesObservation(venue.placesContent?.allowsDogs, now) ? facts.dogs : null;
  const hours = facts.hours && !placesOpeningHours(venue.placesContent, now, PLACES_REFRESH_DAYS) ? facts.hours.hours : null;
  if (!dogs && !hours) return null;
  const credit = <small className="venuePlacesDetailsCredit">Pub website · Read {read(facts.readOn)}</small>;
  return (
    <div className="venuePlacesDetails">
      {dogs ? <div>
        <div className="amenityRow" aria-label="Pub website dog policy">
          <span className={dogs.policy === "welcome" ? "amenity" : "amenity amenity--absent"} title={dogs.evidence}>
            {dogs.policy === "welcome" ? "Dogs welcome" : "No dogs"}
          </span>
        </div>
        {credit}
      </div> : null}
      {hours ? <details>
        <summary>Opening hours</summary>
        <dl>{[1, 2, 3, 4, 5, 6, 0].map((day) => {
          const windows = hours[day];
          return <div key={day}>
            <dt>{DAYS[day]}</dt>
            <dd>{windows === undefined ? "Not stated" : windows.length ? windows.map((window) => `${window.opens} to ${window.closes}`).join(", ") : "Closed"}</dd>
          </div>;
        })}</dl>
        {credit}
      </details> : null}
    </div>
  );
}
