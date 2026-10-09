import { OSM_ATTRIBUTION, type BasemapProvider } from "@/components/map/canvas/tokens";

/**
 * The map's licence credit as copy, for the phone.
 *
 * MapLibre draws the same credit as a compact (i) control on the map. On a
 * phone this is its second home, as readable copy: first thing in More map
 * controls, under the Key. The pub-data line is `OSM_ATTRIBUTION`, the same constant the
 * map is built with, so the two can never say different things, and the basemap
 * line is the one its provider asks for, word for word.
 */
export default function MapCredits({ basemap = "openfreemap" }: { basemap?: BasemapProvider }) {
  return (
    <section className="mobileMapCredits" aria-labelledby="mobileMapCreditsHeading">
      <h3 id="mobileMapCreditsHeading">Map credits</h3>
      <p>{OSM_ATTRIBUTION}.</p>
      {basemap === "carto" ? (
        <p>
          &copy; <a href="https://carto.com/about-carto/" target="_blank" rel="noreferrer noopener">CARTO</a>, &copy;{" "}
          <a href="https://www.openstreetmap.org/about/" target="_blank" rel="noreferrer noopener">OpenStreetMap</a> contributors
        </p>
      ) : <p>
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
      </p>}
    </section>
  );
}
