import { describe, expect, it } from "vitest";

import { sanitizeEvent } from "@/lib/analyticsEvents";

describe("map reader position analytics", () => {
  it("drops coordinate-shaped analytics props", () => {
    const event = sanitizeEvent("tonight_screen_view", {
      lat: 51.5,
      lng: -0.1,
    });
    expect(event).not.toBeNull();
    expect(JSON.stringify(event)).not.toMatch(/51\.5/);
  });
});
