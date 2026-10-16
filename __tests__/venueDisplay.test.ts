import { describe, expect, it } from "vitest";

import { displayVenueAddress, venueAreaLabel } from "@/lib/venueDisplay";

describe("venue display identity", () => {
  it("drops only a stray Greater address component", () => {
    expect(displayVenueAddress("4 Leather Ln, Greater, London EC1N 7RA, UK")).toBe(
      "4 Leather Ln, London EC1N 7RA, UK",
    );
    expect(displayVenueAddress("Camden, Greater London")).toBe(
      "Camden, Greater London",
    );
  });

  it("prefers neighbourhood locality over official borough", () => {
    expect(venueAreaLabel({ locality: "Hatton Garden", primaryBorough: "Camden" })).toBe(
      "Hatton Garden",
    );
    expect(venueAreaLabel({ locality: "London", primaryBorough: "Westminster" })).toBe(
      "Westminster",
    );
    expect(venueAreaLabel({ locality: " greater london ", primaryBorough: "Southwark" })).toBe(
      "Southwark",
    );
    expect(venueAreaLabel({ primaryBorough: "Camden" })).toBe("Camden");
  });
});
