import type { Venue } from "@/lib/venues";

export function mergeLazyDetailPins(slimPins: Venue[], detailById: Map<string, Venue>): Venue[] {
  const seen = new Set<string>();
  const merged = slimPins.map((pin) => {
    seen.add(pin.id);
    const detail = detailById.get(pin.id);
    if (!detail) return pin;
    // The fare zone and the published price's read day are stamped on the
    // slim pin only; the detail artifact has neither, so they ride onto the
    // hydrated record. The zone feeds the zone lens and the sheet's zone
    // compare; the read day keeps a fresh price from looking aging once the
    // pub is opened (components/map/canvas/geojson.ts, pinPriceAging).
    // The slim builder carries sourced features before a detail request. Keep
    // those same facts when opening a pub, so its filter membership stays put.
    const featureHints = pin.filterHints?.outdoorSeating || pin.filterHints?.beerGardenSource || pin.filterHints?.liveSportsSource || pin.filterHints?.dogsWelcome || pin.filterHints?.amenities.liveSports || pin.filterHints?.amenities.darts || pin.filterHints?.amenities.pool
      ? { ...pin.filterHints, ...detail.filterHints,
          amenities: { ...pin.filterHints.amenities, ...detail.filterHints?.amenities,
            liveSports: pin.filterHints.amenities.liveSports,
            darts: pin.filterHints.amenities.darts,
            pool: pin.filterHints.amenities.pool },
          ...(pin.filterHints.liveSportsSource ? { liveSportsSource: pin.filterHints.liveSportsSource } : {}),
          ...(pin.filterHints.dogsWelcome ? { dogsWelcome: pin.filterHints.dogsWelcome } : {}),
          ...(pin.filterHints.outdoorSeating ? { outdoorSeating: pin.filterHints.outdoorSeating } : {}),
          ...(pin.filterHints.beerGardenSource ? { beerGardenSource: pin.filterHints.beerGardenSource,
            amenities: { ...pin.filterHints.amenities, ...detail.filterHints?.amenities, beerGarden: true } } : {}),
        }
      : undefined;
    const carried: Partial<Pick<Venue, "zone" | "priceObservedAt" | "filterHints">> = {
      ...(featureHints ? { filterHints: featureHints } : {}),
      ...(detail.zone === undefined && pin.zone !== undefined ? { zone: pin.zone } : {}),
      ...(detail.priceObservedAt === undefined && pin.priceObservedAt !== undefined
        ? { priceObservedAt: pin.priceObservedAt }
        : {}),
    };
    return Object.keys(carried).length > 0 ? { ...detail, ...carried } : detail;
  });

  // A retired pub is answered by id for a stored reference and is never a pin,
  // so it joins no nearby, search or filter set either.
  for (const [id, venue] of detailById) {
    if (!seen.has(id) && !venue.retired) merged.push(venue);
  }

  return merged;
}
