import { describe, expect, it } from "vitest";

import type { PalCard } from "@/lib/palChat";
import { palRecommendationPinOffsets, palRecommendationPoints } from "@/lib/palRecommendationMap";

const card = (venueId: string, title = venueId): PalCard => ({
  key: venueId, venueId, title, place: "Soho", note: "", price: null,
  provenance: { kind: "directory", label: "On record" },
});

describe("the recommendation map", () => {
  it("keeps four coincident pins distinct while retaining each pub's anchor", () => {
    const offsets = palRecommendationPinOffsets([{ x: 100, y: 100 }, { x: 100, y: 100 }, { x: 100, y: 100 }, { x: 100, y: 100 }]);
    expect(offsets).toHaveLength(4);
    for (let i = 0; i < offsets.length; i += 1) {
      for (let j = i + 1; j < offsets.length; j += 1) {
        expect(Math.max(Math.abs(offsets[i]!.x - offsets[j]!.x), Math.abs(offsets[i]!.y - offsets[j]!.y))).toBeGreaterThanOrEqual(44);
      }
    }
  });

  it("locates the four answer cards in answer order, without adding other pubs", () => {
    const points = palRecommendationPoints(
      [card("a", "First pub"), card("b"), card("c"), card("d")],
      [
        { id: "d", lat: 51.511, lng: -0.132 },
        { id: "a", lat: 51.513, lng: -0.134 },
        { id: "unrelated", lat: 51.499, lng: -0.120 },
        { id: "c", lat: 51.512, lng: -0.133 },
        { id: "b", lat: 51.514, lng: -0.135 },
      ],
    );
    expect(points).toEqual([
      { venueId: "a", name: "First pub", lat: 51.513, lng: -0.134, number: 1 },
      { venueId: "b", name: "b", lat: 51.514, lng: -0.135, number: 2 },
      { venueId: "c", name: "c", lat: 51.512, lng: -0.133, number: 3 },
      { venueId: "d", name: "d", lat: 51.511, lng: -0.132, number: 4 },
    ]);
  });

  it("does not invent a location for unknown, duplicate or invalid pubs", () => {
    expect(palRecommendationPoints(
      [card("missing"), card("a"), card("a"), card("invalid")],
      [{ id: "a", lat: 51.513, lng: -0.134 }, { id: "invalid", lat: NaN, lng: -0.1 }],
    )).toEqual([{ venueId: "a", name: "a", lat: 51.513, lng: -0.134, number: 2 }]);
  });
});
