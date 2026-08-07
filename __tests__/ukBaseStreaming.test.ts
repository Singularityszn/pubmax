import { describe, expect, it } from "vitest";

import {
  nextUkBaseStreamToken,
  parseUkBaseRestoreResponse,
  visibleUkBaseStreamState,
} from "@/components/map/pubmap/useUkBaseStreaming";

describe("nextUkBaseStreamToken", () => {
  it("invalidates an in-flight request before declining a below-gate stream", () => {
    const generation = { current: 4 };
    const inFlightToken = generation.current;

    expect(nextUkBaseStreamToken(generation, 10, 13)).toBeNull();
    expect(generation.current).toBe(5);
    expect(inFlightToken).not.toBe(generation.current);
  });
});

describe("visibleUkBaseStreamState", () => {
  it("returns one stable empty state while a drink lens suspends base pubs", () => {
    const published = { scopeKey: "london", count: 2, pubs: [] };

    const first = visibleUkBaseStreamState(published, "london", true);
    const second = visibleUkBaseStreamState(published, "london", true);

    expect(first).toBe(second);
    expect(first).toEqual({ count: 0, pubs: [] });
  });
});

describe("parseUkBaseRestoreResponse (streaming module export)", () => {
  it("is exported for cold-restore wiring tests", () => {
    expect(
      parseUkBaseRestoreResponse(
        {
          pub: {
            id: "venue-uk-n9",
            name: "The Test",
            address: "",
            lat: 51.5,
            lng: -0.1,
            curatedVenueId: "",
          },
        },
        "venue-uk-n9",
      )?.name,
    ).toBe("The Test");
  });
});
