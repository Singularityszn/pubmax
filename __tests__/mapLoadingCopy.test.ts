import { describe, expect, it } from "vitest";

import {
  MAP_LOADING_SLOW_LINE,
  mapLoadingPrimaryLine,
} from "@/lib/mapLoadingCopy";

describe("mapLoadingCopy", () => {
  it("names the city in the primary loading line", () => {
    expect(mapLoadingPrimaryLine("London")).toBe("Loading London pubs…");
    expect(mapLoadingPrimaryLine("Manchester")).toBe("Loading Manchester pubs…");
  });

  it("falls back when the city name is empty", () => {
    expect(mapLoadingPrimaryLine("")).toBe("Loading pubs…");
    expect(mapLoadingPrimaryLine("   ")).toBe("Loading pubs…");
  });

  it("keeps the slow line short and honest", () => {
    expect(MAP_LOADING_SLOW_LINE).toBe("Still loading pubs…");
  });
});
