import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { TONIGHT_PINS_DISMISS_LABEL } from "@/components/map/TonightLane";

describe("tonight pins dismiss name", () => {
  it("names the control for pins, not search or an area", () => {
    expect(TONIGHT_PINS_DISMISS_LABEL).toBe("Dismiss Pins");
    expect(TONIGHT_PINS_DISMISS_LABEL.toLowerCase()).not.toContain("search");
    expect(TONIGHT_PINS_DISMISS_LABEL.toLowerCase()).not.toContain("area");
    const source = readFileSync("components/map/TonightLane.tsx", "utf8");
    expect(source).toContain("aria-label={TONIGHT_PINS_DISMISS_LABEL}");
    expect(source).not.toContain("Dismiss tonight map pins");
  });
});
