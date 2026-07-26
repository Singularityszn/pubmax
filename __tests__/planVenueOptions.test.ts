import { describe, expect, it } from "vitest";

import { planVenueOptions } from "@/lib/planVenueOptions";

describe("planVenueOptions", () => {
  it("keeps legacy and explicit pubs while excluding other venue kinds", () => {
    expect(
      planVenueOptions([
        { id: "legacy", name: "Legacy Arms", address: "1 High Street" },
        { id: "pub", name: "Explicit Pub", kind: "pub" },
        { id: "bar", name: "Cocktail Bar", kind: "bar" },
        { id: "food", name: "Doner Shop", kind: "food" },
      ]),
    ).toEqual([
      { id: "legacy", name: "Legacy Arms", address: "1 High Street" },
      { id: "pub", name: "Explicit Pub" },
    ]);
  });

  it("drops malformed rows and unknown kinds", () => {
    expect(
      planVenueOptions([
        null,
        { id: "", name: "Missing id" },
        { id: "missing-name" },
        { id: "future", name: "Future Venue", kind: "cinema" },
      ]),
    ).toEqual([]);
  });
});
