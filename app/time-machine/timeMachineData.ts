import "server-only";

import history from "@/public/data/price_history/london.json";

import { parsePriceHistory } from "@/lib/priceHistory";
import { buildTimeMachine, type TimeMachineData } from "@/lib/priceTimeMachine";
import { getVenueIndex } from "@/lib/venueIndex";

// The page and its share card read the same answer. The history file is a
// static import, inlined by the bundler like the landing archive
// (lib/landingPubCard.server.ts), so no route assembles its path at runtime.
// The venue index places each pub; a pub it holds as retired keeps its name
// and its row but draws no pin, because a retired pub is never listed on the
// map. Hold the promise so concurrent first renders share one index read.
let cached: Promise<TimeMachineData | null> | null = null;

export function loadTimeMachine(): Promise<TimeMachineData | null> {
  cached ??= getVenueIndex()
    .then((index) => {
      // An empty index is a failed read, not a London with no pubs: answer
      // this render without pins and let the next one try again.
      if (index.size === 0) cached = null;
      return buildTimeMachine(parsePriceHistory(history), (venueId) => {
        const ref = index.get(venueId);
        if (!ref) return null;
        return ref.retired
          ? { name: ref.name, lat: Number.NaN, lng: Number.NaN }
          : { name: ref.name, lat: ref.lat, lng: ref.lng };
      });
    })
    .catch(() => {
      cached = null;
      return buildTimeMachine(parsePriceHistory(history), () => null);
    });
  return cached;
}
