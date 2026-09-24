import { describe, expect, it } from "vitest";

import { gradePalCase } from "@/evals/pal/grade";
import { loadPalEvalVenueIndex } from "@/evals/pal/venueIndex";

describe("Pal eval graders", () => {
  it("flags invented venue ids on cards", () => {
    const index = loadPalEvalVenueIndex();
    const outcome = gradePalCase(
      {
        answer: "1 pick.",
        cards: [
          {
            key: "fake",
            venueId: "venue-not-in-index",
            title: "Imaginary Arms",
            place: "Soho",
            note: "",
            price: 4.5,
          },
        ],
        proposals: [],
        sources: [],
        status: "ready",
        toolsUsed: ["search_venues"],
      },
      { expectedTools: ["search_venues"], minCards: 1 },
      index,
      ["search_venues"],
    );
    expect(outcome.inventedVenues).toBe(1);
    expect(outcome.pass).toBe(false);
  });
});
