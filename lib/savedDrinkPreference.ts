import type { DrinkCategory } from "@/lib/drinks";
import { DEFAULT_DRINK_LANE, MAP_DRINK_LANES } from "@/lib/drinkLanes";
import type { NightProfileInput } from "@/lib/nightProfile";

/** The drink an account saved in its Night Profile, as the map can show it. */
export type SavedDrink =
  | { kind: "lane"; category: DrinkCategory; label: string }
  | { kind: "zero-proof"; label: string };

/**
 * Read the saved drink for this city. The pint lane is the map's default, so a
 * saved beer asks for nothing, and a category the map has no lane for is left out.
 */
export function savedDrinkFromProfile(
  profile: Pick<NightProfileInput, "cityId" | "context"> | null,
  cityId: string,
): SavedDrink | null {
  if (!profile || profile.cityId !== cityId) return null;
  if (profile.context.zeroProof) return { kind: "zero-proof", label: "Alcohol-free" };
  const lane = MAP_DRINK_LANES.find((candidate) => candidate.category === profile.context.drinkCategory);
  if (!lane || lane.category === DEFAULT_DRINK_LANE) return null;
  return { kind: "lane", category: lane.category, label: lane.label };
}

/** Whether the map already shows the saved drink, so there is nothing to offer. */
export function savedDrinkIsShowing(
  saved: SavedDrink,
  map: { drinkLane: DrinkCategory; noAlcoholView: boolean },
): boolean {
  return saved.kind === "zero-proof" ? map.noAlcoholView : !map.noAlcoholView && map.drinkLane === saved.category;
}
