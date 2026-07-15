import { describe, expect, it } from "vitest";
import { NIGHT_SIGNALS } from "@/components/landing/NightSignals";

describe("Night Signals", () => {
  it("defines six fictional accessible adult character worlds", () => {
    expect(NIGHT_SIGNALS).toHaveLength(6);
    expect(new Set(NIGHT_SIGNALS.map(signal => signal.family)).size).toBe(6);
    for (const signal of NIGHT_SIGNALS) {
      expect(signal.accessibleDescription).toMatch(/adult/);
      expect(signal.accessibleDescription).toMatch(/synthetic|fictional|holographic|digital|faceted|translucent/);
    }
  });
});
