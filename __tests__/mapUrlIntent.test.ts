import { describe, expect, it } from "vitest";

import { allowsMapViewportResume } from "@/lib/mapUrlIntent";

describe("viewport-only resume on contribution entry", () => {
  it.each(["", "?", "?log=1", "log=1", "?contribute=price"])("allows %s", (search) => {
    expect(allowsMapViewportResume(search)).toBe(true);
  });

  it.each([
    "?log=0", "?log=", "?contribute=other", "?log=1&log=1", "?log=0&log=1",
    "?contribute=price&contribute=price", "?log=1&contribute=price", "?unknown=1",
    ...["q=Richmond", "sel=venue-19mn6ss", "lat=51.5", "lng=-0.1", "zoom=14",
      "area=camden", "crawl=1", "pubs=a,b", "plan=1", "mode=build", "style=cheapest",
      "drink=wine", "food=1", "max=5", "accept=1", "src=home", "price=5", "unknown="]
      .flatMap((param) => [`?${param}`, `?log=1&${param}`, `?${param}&contribute=price`]),
  ])("rejects %s", (search) => {
    expect(allowsMapViewportResume(search)).toBe(false);
  });
});
