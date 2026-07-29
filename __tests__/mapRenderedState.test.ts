import { describe, expect, it } from "vitest";

import { deriveMapRenderedState } from "@/lib/mapRenderedState";

function feature(bucket: number, kind = "pub"): GeoJSON.Feature {
  return {
    type: "Feature",
    properties: { bucket, kind },
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
      priceMeanings: ["pint"],
      storyColour: "#d99f45",
    });
  });

  it("derives price meanings from only the features in the scene", () => {
    const pubOnly: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: [feature(0), feature(2)],
    };
    const mixed: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: [feature(0), feature(1, "bar")],
    };

    expect(
      deriveMapRenderedState(pubOnly, { brass: "#b0813a" }, null)
        .priceMeanings,
    ).toEqual(["pint"]);
    expect(
      deriveMapRenderedState(mixed, { brass: "#b0813a" }, null)
        .priceMeanings,
    ).toEqual(["pint", "type-relative"]);
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
