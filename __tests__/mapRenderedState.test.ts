import { describe, expect, it } from "vitest";

import { deriveMapRenderedState } from "@/lib/mapRenderedState";

function feature(bucket: number): GeoJSON.Feature {
  return {
    type: "Feature",
    properties: { bucket },
    geometry: {
      type: "Point",
      coordinates: [-2.24, 53.48],
    },
  };
}

describe("deriveMapRenderedState", () => {
  it("reports the exact source buckets and resolved story colour", () => {
    const pubsData: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: [feature(3), feature(1), feature(1)],
    };

    expect(
      deriveMapRenderedState(
        pubsData,
        { brass: "#b0813a", amber: "#d99f45" },
        "amber",
      ),
    ).toEqual({
      priceBuckets: [1, 3],
      storyColour: "#d99f45",
    });
  });

  it("resolves the story token again when scene theme tokens change", () => {
    const pubsData: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: [feature(0)],
    };

    const light = deriveMapRenderedState(
      pubsData,
      { brass: "#b0813a", amber: "#d99f45" },
      "amber",
    );
    const dark = deriveMapRenderedState(
      pubsData,
      { brass: "#ff6b7a", amber: "#ffc247" },
      "amber",
    );

    expect(light.storyColour).toBe("#d99f45");
    expect(dark.storyColour).toBe("#ffc247");
  });
});
