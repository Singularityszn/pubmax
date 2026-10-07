import { OSM_ATTRIBUTION } from "@/components/map/canvas/tokens";

/**
 * The map's licence credit as copy, for the phone.
 *
 * MapLibre draws the same credit as a compact (i) control. On a phone that
 * control was a fourth floating layer over the pins, so it is not painted
 * there and this is where a reader finds it: first thing in More map controls,
 * under the Key. The pub-data line is `OSM_ATTRIBUTION`, the same constant the
 * map is built with, so the two can never say different things, and the basemap
 * line is the one its provider asks for, word for word.
 */
export default function MapCredits() {
  return (
    <section className="mobileMapCredits" aria-labelledby="mobileMapCreditsHeading">
      <h3 id="mobileMapCreditsHeading">Map credits</h3>
      <p>{OSM_ATTRIBUTION}.</p>
      <p>
        <a href="https://openfreemap.org" target="_blank" rel="noreferrer noopener">
          OpenFreeMap
        </a>{" "}
        &copy;{" "}
        <a href="https://www.openmaptiles.org/" target="_blank" rel="noreferrer noopener">
          OpenMapTiles
        </a>{" "}
        Data from{" "}
        <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer noopener">
          OpenStreetMap
        </a>
      </p>
    </section>
  );
}
