/**
 * The ODbL credit a desk answer owes.
 *
 * `/near` renders no map canvas, so `OSM_ATTRIBUTION` (passed to MapLibre as
 * `customAttribution`) never reaches this surface, and every desk card prints
 * OSM's own name, address, opening hours and wifi tag. The credit therefore
 * rides the answer itself, the way `UnverifiedPubSheet` and `CityChooser`
 * already credit the rows they show.
 */
import styles from "./nearDeskNow.module.css";

export default function DeskDataCredit() {
  return (
    <p className={styles.ndnSource}>
      Desk data from{" "}
      <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
        OpenStreetMap contributors
      </a>
      , ODbL.
    </p>
  );
}
