import type { CityId } from "@/lib/cities";
import { formatObservedDate, PINT_DATASET_OBSERVED_AT } from "@/lib/dataFreshness";
import { mapPricesReadLine } from "@/lib/mapLoadingCopy";

/**
 * The loading screens' snapshot line for one city's map, built on the server.
 * Only London's map reads the bundled London pint snapshot, so every other city
 * gets null. `/map`, `/map/london` and the London `/map/arrival` all come here,
 * so one London route cannot drop the line while another prints it (Codex on
 * #2276).
 */
export function mapPricesReadLineFor(cityId: CityId): string | null {
  return cityId === "london" ? mapPricesReadLine(formatObservedDate(PINT_DATASET_OBSERVED_AT)) : null;
}
