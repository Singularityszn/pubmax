import { describe, expect, it } from "vitest";

import {
  bubbleY,
  easeOutCubic,
  FOAM_POURING,
  FOAM_SETTLED,
  foamPathD,
  foamStep,
  GLASS_FLOOR_Y,
  GLASS_RIM_Y,
  GLASS_VIEW_H,
  glassLevelShare,
  glassLevelY,
  makeBubbles,
  pourDurationMs,
  sloshAmplitude,
  sloshTilt,
} from "@/components/wild/priceGlassMotion";

// The Price Glass's geometry and motion curves (components/wild/
// priceGlassMotion.ts): the level is the price, the figure lands and never
// overshoots, and every swing settles.

describe("the level is the price", () => {
  it("sits on the floor at £0 and just under the rim at the top of the scale", () => {
    expect(glassLevelY(0, 10)).toBe(GLASS_FLOOR_Y);
    const full = glassLevelY(10, 10);
    expect(full).toBeGreaterThan(GLASS_RIM_Y);
    expect(full).toBeLessThan(GLASS_RIM_Y + 10);
  });

  it("rises in step with the price, and a price over the scale fills no further", () => {
    const a = glassLevelY(5.2, 10);
    const b = glassLevelY(6.15, 10);
    expect(b).toBeLessThan(a);
    expect(glassLevelY(12, 10)).toBe(glassLevelY(10, 10));
    expect(glassLevelY(-1, 10)).toBe(GLASS_FLOOR_Y);
    // Half the price is half the height of the scale.
    const half = glassLevelY(5, 10);
    expect(GLASS_FLOOR_Y - half).toBeCloseTo((GLASS_FLOOR_Y - glassLevelY(10, 10)) / 2, 6);
  });

  it("gives an HTML label the same place as a share of the drawing", () => {
    expect(glassLevelShare(5.2, 10)).toBeCloseTo(glassLevelY(5.2, 10) / GLASS_VIEW_H, 9);
  });
});

describe("the pour", () => {
  it("eases out and lands exactly, never past the price", () => {
    let previous = -1;
    for (let t = 0; t <= 1.0001; t += 0.05) {
      const value = easeOutCubic(t);
      expect(value).toBeGreaterThanOrEqual(previous);
      expect(value).toBeLessThanOrEqual(1);
      previous = value;
    }
    expect(easeOutCubic(1)).toBe(1);
    expect(easeOutCubic(2)).toBe(1);
  });

  it("takes longer for a long pour, and none is slow", () => {
    expect(pourDurationMs(0, 9.5, 10)).toBeGreaterThan(pourDurationMs(5.5, 6, 10));
    expect(pourDurationMs(0, 10, 10)).toBeLessThanOrEqual(1600);
  });

  it("rocks harder for a bigger change, and the rock dies away", () => {
    expect(sloshAmplitude(0, 9.5, 10)).toBeGreaterThan(sloshAmplitude(5.5, 6, 10));
    const amp = sloshAmplitude(0, 9.5, 10);
    const early = Math.max(...[100, 140, 180].map((ms) => Math.abs(sloshTilt(amp, ms))));
    const late = Math.max(...[3000, 3140, 3280].map((ms) => Math.abs(sloshTilt(amp, ms))));
    expect(early).toBeGreaterThan(1);
    expect(late).toBeLessThan(0.1);
    expect(sloshTilt(amp, -10)).toBe(0);
  });

  it("lets a tall head settle to a finger", () => {
    let foam = FOAM_POURING;
    for (let frame = 0; frame < 240; frame += 1) foam = foamStep(foam, FOAM_SETTLED, 16, 650);
    expect(foam).toBeCloseTo(FOAM_SETTLED, 1);
    expect(foamStep(FOAM_POURING, FOAM_SETTLED, 16, 0)).toBe(FOAM_SETTLED);
  });

  it("draws a closed head with no gaps in its numbers", () => {
    const d = foamPathD(200, 13, 4, 1.3);
    expect(d.startsWith("M")).toBe(true);
    expect(d.endsWith("Z")).toBe(true);
    expect(d).not.toMatch(/NaN|Infinity/);
  });

  it("keeps its bubbles under the surface, and none in a nearly empty glass", () => {
    const bubbles = makeBubbles(16);
    expect(makeBubbles(16)).toEqual(bubbles);
    for (const bubble of bubbles) {
      for (const now of [0, 333, 5000, 99999]) {
        const y = bubbleY(bubble, now, 220);
        expect(y).not.toBeNull();
        expect(y!).toBeGreaterThanOrEqual(220);
        expect(y!).toBeLessThanOrEqual(GLASS_FLOOR_Y);
      }
      expect(bubbleY(bubble, 1000, GLASS_FLOOR_Y - 8)).toBeNull();
    }
  });
});
