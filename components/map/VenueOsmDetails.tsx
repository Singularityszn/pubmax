import { osmPubFactsView, type OsmPubFacts } from "@/lib/osmPubFacts";
import "./venuePlacesDetails.css";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * A clock time as a reader reads it. OSM writes a close past midnight as an
 * hour from 24 (`28:00` is 04:00 the next morning, `24:15` is 00:15), which is
 * no wall-clock time, so it prints the next day's clock and says so. `24:00`
 * is the end of the day and stays as written.
 */
function clockLabel(time: string): string {
  const match = /^(\d{2}):(\d{2})$/.exec(time);
  const hour = Number(match?.[1]);
  if (!match || hour < 24 || time === "24:00") return time;
  return `${String(hour - 24).padStart(2, "0")}:${match[2]} next day`;
}

/**
 * What OpenStreetMap states about the pub: hours, access, sport, seating, ale,
 * dogs, the menu and social links, and who runs it. Each group carries its
 * source and day, and the block carries the ODbL credit. It sits beside the
 * Google Places and pub website blocks and never merges with them, so a pub
 * with two answers shows both, each under its own name. A day the OSM hours do
 * not state reads as not stated, and hours that do not read cleanly are printed
 * as OSM writes them.
 */
export default function VenueOsmDetails({ facts }: { facts: OsmPubFacts | null | undefined }) {
  const view = osmPubFactsView(facts);
  if (!view) return null;
  const { hours, hoursRaw } = view;
  const hasFacts = view.chips.length > 0 || view.ownership.length > 0 || view.links.length > 0;
  return (
    <div className="venuePlacesDetails">
      {hours || hoursRaw ? <details>
        <summary>OpenStreetMap opening hours</summary>
        {hours ? <dl>{[1, 2, 3, 4, 5, 6, 0].map((day) => {
          const windows = hours[day];
          return <div key={day}>
            <dt>{DAYS[day]}</dt>
            <dd>{windows === undefined ? "Not stated" : windows.length ? windows.map((window) => `${clockLabel(window.opens)} to ${clockLabel(window.closes)}`).join(", ") : "Closed"}</dd>
          </div>;
        })}</dl> : <p>{hoursRaw}</p>}
        <small className="venuePlacesDetailsCredit">{view.hoursCredit}</small>
      </details> : null}
      {hasFacts ? <div>
        {view.chips.length > 0 ? <div className="amenityRow" aria-label="OpenStreetMap amenities">
          {view.chips.map((chip) => (
            <span key={chip.label} className={chip.absent ? "amenity amenity--absent" : "amenity"}>{chip.label}</span>
          ))}
        </div> : null}
        {view.ownership.length > 0 ? <dl>{view.ownership.map((row) => (
          <div key={row.label}>
            <dt>{row.label}</dt>
            <dd>{row.value}</dd>
          </div>
        ))}</dl> : null}
        {view.links.length > 0 ? <div className="venuePlacesDetailsLinks">
          {view.links.map((link) => (
            <a key={link.label} href={link.href} target="_blank" rel="noopener noreferrer">{link.label}</a>
          ))}
        </div> : null}
        <small className="venuePlacesDetailsCredit">{view.credit}</small>
      </div> : null}
      <small className="venuePlacesDetailsCredit">
        Facts from{" "}
        <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">
          OpenStreetMap contributors
        </a>
        , ODbL
      </small>
    </div>
  );
}
