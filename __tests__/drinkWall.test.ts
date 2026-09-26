import { describe, expect, it } from "vitest";

import { validateDrinkWallSubmission } from "@/lib/drinkWall";
import { drinkWallServingKey, photoObjectKey, venuePhotoServingKey } from "@/lib/venuePhotos";

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

  it("refuses a pint tagged with a drink outside the listed ones", () => {
    expect(
      validateDrinkWallSubmission({ wallCategory: "pint", venueId: "venue-abc", drinkCategory: "beer" }).ok,
    ).toBe(true);
    expect(validateDrinkWallSubmission({ wallCategory: "pint", venueId: "venue-abc" }).ok).toBe(true);
    expect(
      validateDrinkWallSubmission({ wallCategory: "pint", venueId: "venue-abc", drinkCategory: "moonshine" }).ok,
    ).toBe(false);
  });

  it("keys a city photo under drink-wall/ and a pub photo under its venue", () => {
    expect(photoObjectKey("PHOTO", null)).toBe(drinkWallServingKey("PHOTO"));
    expect(photoObjectKey("PHOTO", "VENUE")).toBe(venuePhotoServingKey("VENUE", "PHOTO"));
  });
});
