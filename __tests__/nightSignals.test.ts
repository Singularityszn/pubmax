import { describe, expect, it } from "vitest";
import { NIGHT_SIGNALS } from "@/components/landing/NightSignals";
import { buildMapSeed } from "@/lib/pubMap";

describe("Night Signals", () => {
  it("defines six accessible nightlife directions without rendering characters", () => {
    expect(NIGHT_SIGNALS).toHaveLength(6);
    expect(new Set(NIGHT_SIGNALS.map(signal => signal.family)).size).toBe(6);
    for (const signal of NIGHT_SIGNALS) {
      expect(signal.accessibleDescription.length).toBeGreaterThan(20);
      expect(signal.description.length).toBeGreaterThan(40);
    }
  });

  it("keeps the paused asset contract dormant and honest", () => {
    for (const signal of NIGHT_SIGNALS) {
      expect(signal.asset.status).toBe("lookdev-fallback");
      expect(signal.asset.posterSrc).toBe(`/night-signals/${signal.id}.svg`);
      expect(signal.asset.modelSrc).toBeNull();
      expect(signal.asset.loopWebmSrc).toBeNull();
      expect(signal.asset.loopMp4Src).toBeNull();
      expect(signal.asset.alphaMode).toBe("transparent");
    }
  });

  it("keeps selectors distinct and avoids unsupported Brandy or Vodka filters", () => {
    expect(new Set(NIGHT_SIGNALS.map((signal) => signal.id)).size).toBe(6);
    expect(NIGHT_SIGNALS.every((signal) => signal.label.length > 0)).toBe(true);
    expect(NIGHT_SIGNALS.every((signal) => signal.accent.startsWith("#"))).toBe(true);
    expect(NIGHT_SIGNALS.find((signal) => signal.family === "brandy")?.mapHref).not.toContain("drink=");
    expect(NIGHT_SIGNALS.find((signal) => signal.family === "vodka")?.mapHref).not.toContain("drink=");
  });

  it("sends every advertised direction to a map state the planner can reproduce", () => {
    for (const signal of NIGHT_SIGNALS) {
      const url = new URL(signal.mapHref, "https://pubmax.test");
      const advertisedStyle = url.searchParams.get("style");
      const seed = buildMapSeed(url.search);

      if (advertisedStyle) {
        expect(seed.filters.crawlStyle, signal.family).toBe(advertisedStyle);
      }
    }
  });
});
