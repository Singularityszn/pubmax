import type { DrinkCategory } from "@/lib/drinks";
import { DEFAULT_DRINK_LANE, MAP_DRINK_LANES } from "@/lib/drinkLanes";
import type { NightProfileInput } from "@/lib/nightProfile";

export type SavedDrink =
  | { kind: "lane"; category: DrinkCategory; label: string }
  | { kind: "zero-proof"; label: string };

const ZERO_PROOF_DRINK: SavedDrink = { kind: "zero-proof", label: "Alcohol-free" };
const SAVED_DRINK_LANES = MAP_DRINK_LANES.map((lane) => ({
  kind: "lane" as const,
  category: lane.category,
  label: lane.label,
}));

/**
 * Read the saved drink for this city. The pint lane is the map's default, so a
 * saved beer asks for nothing, and a category the map has no lane for is left out.
 */
export function savedDrinkFromProfile(
  profile: Pick<NightProfileInput, "cityId" | "context"> | null,
  cityId: string,
): SavedDrink | null {
  if (!profile || profile.cityId !== cityId) return null;
  if (profile.context.zeroProof) return ZERO_PROOF_DRINK;
  const lane = SAVED_DRINK_LANES.find((candidate) => candidate.category === profile.context.drinkCategory);
  if (!lane || lane.category === DEFAULT_DRINK_LANE) return null;
  return lane;
}

/** Whether the map already shows the saved drink, so there is nothing to offer. */
export function savedDrinkIsShowing(
  saved: SavedDrink,
  map: { drinkLane: DrinkCategory; noAlcoholView: boolean },
): boolean {
  return saved.kind === "zero-proof" ? map.noAlcoholView : !map.noAlcoholView && map.drinkLane === saved.category;
}
