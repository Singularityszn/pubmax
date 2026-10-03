import type { Venue } from "@/lib/venues";

export function mergeLazyDetailPins(slimPins: Venue[], detailById: Map<string, Venue>): Venue[] {
  const seen = new Set<string>();
  const merged = slimPins.map((pin) => {
    seen.add(pin.id);
    return detailById.get(pin.id) ?? pin;
  });

  // A retired pub is answered by id for a stored reference and is never a pin,
  // so it joins no nearby, search or filter set either.
  for (const [id, venue] of detailById) {
    if (!seen.has(id) && !venue.retired) merged.push(venue);
  }

  return merged;
}
