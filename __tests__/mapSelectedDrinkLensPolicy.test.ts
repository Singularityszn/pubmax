import { describe, expect, it } from "vitest";

import { activeDrinkLane, DEFAULT_DRINK_LANE } from "@/lib/drinkLanes";
import { isMapLensDrinkCategory } from "@/lib/mapExperienceLens";
import { activeLensLabelFor, mapDrinkLensSelection } from "@/lib/pubMap";

const dependencies = { activeDrinkLane, defaultDrinkLane: DEFAULT_DRINK_LANE, isMapLensDrinkCategory };

describe("selected drink identity on the public map", () => {
  it.each(["", "beer"])("selects the Cider lens from category %j without claiming a generic pint", (drinkCategory) => {
    expect(mapDrinkLensSelection({ ...dependencies, drinkCategory, drinkSubtype: "beer-cider", experienceLens: "all" }))
      .toEqual({ selectedDrinkCategory: "beer", mapDrinkLensCategory: "beer", activeMapDrinkLane: "beer" });
    expect(activeLensLabelFor("beer", "all", "beer-cider")).toBe("Cider");
  });

  it("keeps the Wine category and names its own selected subtype", () => {
    expect(mapDrinkLensSelection({ ...dependencies, drinkCategory: "wine", drinkSubtype: "wine-white", experienceLens: "all" }))
      .toEqual({ selectedDrinkCategory: "wine", mapDrinkLensCategory: "wine", activeMapDrinkLane: "wine" });
    expect(activeLensLabelFor("wine", "all", "wine-white")).toBe("White wine");
  });

  it("rejects the generic Other category", () => {
    expect(mapDrinkLensSelection({ ...dependencies, drinkCategory: "other", drinkSubtype: null, experienceLens: "all" }).mapDrinkLensCategory)
      .toBeNull();
  });

  it("keeps generic beer on the resting pint view", () => {
    expect(mapDrinkLensSelection({ ...dependencies, drinkCategory: "beer", experienceLens: "all" }).mapDrinkLensCategory)
      .toBeNull();
  });

  it("keeps Food in control when a saved Cider choice is present", () => {
    expect(mapDrinkLensSelection({ ...dependencies, drinkCategory: "beer", drinkSubtype: "beer-cider", experienceLens: "food" }))
      .toEqual({ selectedDrinkCategory: "beer", mapDrinkLensCategory: null, activeMapDrinkLane: "beer" });
  });

  it("rejects a subtype from another drink category", () => {
    expect(mapDrinkLensSelection({ ...dependencies, drinkCategory: "beer", drinkSubtype: "wine-white", experienceLens: "all" }).mapDrinkLensCategory)
      .toBeNull();
    expect(activeLensLabelFor("wine", "all", "beer-cider")).toBe("Wine");
  });
});
