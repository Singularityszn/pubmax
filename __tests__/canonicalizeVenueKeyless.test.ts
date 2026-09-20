import { describe, expect, it } from "vitest";

import { typesafeConfigured } from "@/lib/samePubIdentity";
import { canonicalizeDataset } from "../scripts/lib/venueCanonicalization.mjs";

describe("canonicalize_venue_dataset keyless law", () => {
  it("runs canonicalizeDataset without any TypeSafe configuration", () => {
    expect(typesafeConfigured({})).toBe(false);
    const rows = [
      {
        app_price_id: "a",
        pub_name: "The Moon on the Hill",
        address: "Harrow",
        latitude: 51.5794,
        longitude: -0.3342,
        price_gbp: 2.49,
        source_datasets: "x",
      },
      {
        app_price_id: "b",
        pub_name: "The Moon on the Hill",
        address: "Harrow seed",
        latitude: 51.5795,
        longitude: -0.335,
        price_gbp: null,
        source_datasets: "y",
      },
    ];
    const { stats } = canonicalizeDataset(rows);
    expect(stats.duplicateClusters).toBe(1);
  });
});
