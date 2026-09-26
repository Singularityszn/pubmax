import { describe, expect, it } from "vitest";

import {
  DRINK_WALL_CITY_CAP_PER_ACCOUNT,
  validateDrinkWallSubmission,
} from "@/lib/drinkWall";

describe("drink wall submission", () => {
  it("requires a pub for pint and pub categories", () => {
    expect(validateDrinkWallSubmission({ wallCategory: "pint" }).ok).toBe(false);
    expect(validateDrinkWallSubmission({ wallCategory: "pub", venueId: "venue-abc" }).ok).toBe(true);
  });

  it("allows city london without a venue", () => {
    const answer = validateDrinkWallSubmission({ wallCategory: "london", placeLabel: "South Bank" });
    expect(answer.ok).toBe(true);
    if (answer.ok) {
      expect(answer.value.venueId).toBe(null);
      expect(answer.value.placeLabel).toBe("South Bank");
    }
  });

  it("requires a listed drink for pints", () => {
    expect(
      validateDrinkWallSubmission({ wallCategory: "pint", venueId: "venue-abc", drinkCategory: "beer" }).ok,
    ).toBe(true);
    expect(validateDrinkWallSubmission({ wallCategory: "pint", venueId: "venue-abc" }).ok).toBe(false);
  });

  it("names the city cap in reader copy", () => {
    expect(DRINK_WALL_CITY_CAP_PER_ACCOUNT).toBe(100);
  });
});
