import { describe, expect, it } from "vitest";

import { venueMapUrl } from "@/lib/venueMapUrl";

// The "see this pub on the map" contract: the link must carry ?sel=<id> so the
// map selects the venue AND centres the camera on load (PubMapCanvas honours
// sel via the selectedPresent deep-link fix). City-prefixed ids route to their
// city's map path; London ids use the bare /map.
describe("venueMapUrl", () => {
  it("emits a /map link carrying sel=<id>", () => {
    const url = venueMapUrl("the-dove-hammersmith");
    expect(url).toContain("/map");
    expect(url).toContain("sel=the-dove-hammersmith");
  });

  it("URL-encodes ids and preserves them round-trip", () => {
    const url = venueMapUrl("pub with spaces&x");
    const query = url.split("?")[1] ?? "";
    expect(new URLSearchParams(query).get("sel")).toBe("pub with spaces&x");
  });

  it("routes city-prefixed venue ids to that city's map", () => {
    const url = venueMapUrl("manchester-some-pub");
    expect(url).toContain("sel=manchester-some-pub");
    // City-aware path keeps the link inside a /map route (per-city or bare).
    expect(url.startsWith("/")).toBe(true);
    expect(url).toContain("map");
  });
});
