import { describe, expect, it } from "vitest";

import { pubsCountLabel } from "@/components/pubs/PubsGallery";

describe("pubs gallery secondary surface", () => {
  it("does not present an incomplete venue read as an authoritative count", () => {
    expect(
      pubsCountLabel({
        matchingPubs: 3,
        filter: "all",
        zone: "all",
        page: 1,
        totalPages: 1,
        complete: false,
      }),
    ).toBe("3 pubs available · Some chain data is unavailable");
  });
});
