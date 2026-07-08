import { describe, expect, it } from "vitest";

import { directVenueImageUrl } from "@/lib/venueImages";

describe("directVenueImageUrl", () => {
  it("keeps direct http and https venue image URLs", () => {
    expect(directVenueImageUrl("https://live.staticflickr.com/pub.jpg")).toBe(
      "https://live.staticflickr.com/pub.jpg",
    );
    expect(directVenueImageUrl("http://example.com/pub.jpg")).toBe(
      "http://example.com/pub.jpg",
    );
  });

  it("rejects redirect/share hosts that do not render as direct images", () => {
    expect(directVenueImageUrl("https://images.app.goo.gl/abc")).toBe("");
    expect(directVenueImageUrl("https://search.app.goo.gl/abc")).toBe("");
  });

  it("rejects invalid or non-web URLs", () => {
    expect(directVenueImageUrl("not a url")).toBe("");
    expect(directVenueImageUrl("javascript:alert(1)")).toBe("");
    expect(directVenueImageUrl("")).toBe("");
  });
});
