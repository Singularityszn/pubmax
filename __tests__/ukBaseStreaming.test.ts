import { describe, expect, it } from "vitest";

import { nextUkBaseStreamToken } from "@/components/map/pubmap/useUkBaseStreaming";

describe("nextUkBaseStreamToken", () => {
  it("invalidates an in-flight request before declining a below-gate stream", () => {
    const generation = { current: 4 };
    const inFlightToken = generation.current;

    expect(nextUkBaseStreamToken(generation, 10, 13)).toBeNull();
    expect(generation.current).toBe(5);
    expect(inFlightToken).not.toBe(generation.current);
  });
});
