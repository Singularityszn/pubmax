import { isCurrentNightOutPlace } from "../../lib/nightOutPlaceContract.mjs";

/**
 * A famous row ships only inside its verification window and with a price
 * anchor to show. A row without an anchor stays in the seed, withheld.
 */
export function isCurrentFamousVenue(row, now) {
  return (
    isCurrentNightOutPlace(row, now) &&
    typeof row.anchor === "object" &&
    row.anchor !== null
  );
}
