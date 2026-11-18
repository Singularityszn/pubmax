import { isUkBaseId } from "@/lib/ukBasePubs";

type Place = { id: string };

export function selectedPlaceIsDrawn(id: string, venues: readonly Place[], cafes: readonly Place[], restaurants: readonly Place[]): boolean {
  return Boolean(id) && (venues.some((place) => place.id === id) || isUkBaseId(id)
    || cafes.some((place) => place.id === id) || restaurants.some((place) => place.id === id));
}
