/**
 * The ODbL credit a UK place-index answer owes.
 *
 * `public/data/uk_base/places.json` is OpenStreetMap-derived (ODbL 1.0), and
 * the map's own `OSM_ATTRIBUTION` rides the MapLibre canvas, which the Places
 * tab does not draw. So the credit rides the ANSWER, the way `DeskDataCredit`
 * already does for `/near`: wherever a surface prints place names read out of
 * that index, it prints this under them.
 *
 * The class is the caller's, because a surface carries its own ink; the words
 * and the link are not, so no surface can drift into its own credit.
 */
export default function PlaceIndexCredit({
  className,
}: {
  className: string;
}) {
  return (
    <p className={className}>
      Place names from{" "}
      <a
        href="https://www.openstreetmap.org/copyright"
        target="_blank"
        rel="noreferrer"
      >
        OpenStreetMap contributors
      </a>
      , ODbL.
    </p>
  );
}
