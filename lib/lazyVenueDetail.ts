import type { Venue } from "@/lib/venues";

export function mergeLazyDetailPins(slimPins: Venue[], detailById: Map<string, Venue>): Venue[] {
  const seen = new Set<string>();
  const merged = slimPins.map((pin) => {
    seen.add(pin.id);
    const detail = detailById.get(pin.id);
    if (!detail) return pin;
    // The fare zone is stamped on the slim pin only; the detail artifact has
    // none, so the pin's zone rides onto the hydrated record for the zone lens
    // and the venue sheet's zone compare.
    return detail.zone === undefined && pin.zone !== undefined
      ? { ...detail, zone: pin.zone }
      : detail;
  });

  // A retired pub is answered by id for a stored reference and is never a pin,
  // so it joins no nearby, search or filter set either.
  for (const [id, venue] of detailById) {
    if (!seen.has(id) && !venue.retired) merged.push(venue);
  }

  return merged;
}
