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

  it("uses an explicit poster-first asset contract without claiming missing production assets", () => {
    expect(NIGHT_SIGNALS.filter((signal) => signal.asset.status === "authored-pilot").map((signal) => signal.id)).toEqual([
      "beer-runner",
    ]);

    for (const signal of NIGHT_SIGNALS) {
      expect(signal.asset.posterSrc).toBe(`/night-signals/${signal.id}.svg`);
      expect(signal.asset.modelSrc).toBeNull();
      expect(signal.asset.loopWebmSrc).toBeNull();
      expect(signal.asset.loopMp4Src).toBeNull();
      expect(signal.asset.alphaMode).toBe("transparent");
    }
  });

  it("keeps every character selector distinct and named", () => {
    expect(new Set(NIGHT_SIGNALS.map((signal) => signal.id)).size).toBe(6);
    expect(NIGHT_SIGNALS.every((signal) => signal.name.includes("/"))).toBe(true);
    expect(NIGHT_SIGNALS.every((signal) => signal.accent.startsWith("#"))).toBe(true);
  });
});
