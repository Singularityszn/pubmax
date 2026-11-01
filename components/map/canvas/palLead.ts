import { trackEvent } from "@/lib/analytics";
import type { PalMapMarker } from "./palMarker";

/** Start the current leg's lead, keeping one report across map rebuilds. */
export function leadPalOnMap({ marker, walk, next, line, reportedKey }: {
  marker: PalMapMarker;
  walk: Parameters<PalMapMarker["walk"]>[0];
  next: Parameters<PalMapMarker["nextStop"]>[0];
  line: string;
  reportedKey: { current: string | null };
}): void {
  marker.walk({
    ...walk,
    onVisible: () => {
      // A rebuilt map leads the same way again without counting another lead.
      if (reportedKey.current !== walk.key) {
        reportedKey.current = walk.key;
        trackEvent("pal_lead_started");
      }
    },
  });
  marker.nextStop(next);
  marker.say(line);
}
