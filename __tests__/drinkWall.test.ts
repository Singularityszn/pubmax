import { describe, expect, it } from "vitest";

import { validateDrinkWallSubmission } from "@/lib/drinkWall";
import { drinkWallServingKey, photoObjectKey, venuePhotoServingKey } from "@/lib/venuePhotos";

describe("drink wall submission", () => {
  it("takes every category with or without a linked pub", () => {
    for (const wallCategory of ["pint", "pub", "london"]) {
      const unlinked = validateDrinkWallSubmission({ wallCategory });
      expect(unlinked.ok && unlinked.value.venueId).toBe(null);
      const linked = validateDrinkWallSubmission({ wallCategory, venueId: "venue-abc" });
      expect(linked.ok && linked.value.venueId).toBe("venue-abc");
    }
    expect(validateDrinkWallSubmission({ wallCategory: "pub", venueId: "../etc" }).ok).toBe(false);
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
