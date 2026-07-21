import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { OG } from "@/lib/ogBrand";

// Contract for the store visual identity masters (issue #440): The Clink mark
// on ink dark with the candle-coral accent, no text, hexes never drifting from
// the OG brand kit, geometry never drifting from the canonical 64-grid Clink
// polygons (components/brand/PubmaxxMark.tsx MARK_GEOMETRY, mirrored by
// scripts/gen-brand-assets.mjs). These are the masters
// scripts/gen-store-assets.mjs renders the whole store PNG set from, so a drift
// here ships to both stores.

const DIR = join(process.cwd(), "public", "store-assets");

// The canonical Clink arms — two tapered pint-glass polygons, symmetric about
// centre (32,32). Copied verbatim from MARK_GEOMETRY.armA / armB; the store
// masters MUST draw these exact point strings.
const CLINK_ARM_A = "19.8,8.7 10.2,17.3 46.0,53.7 52.0,48.3";
const CLINK_ARM_B = "44.2,8.7 53.8,17.3 18.0,53.7 12.0,48.3";

// Masters that draw the Clink arms at all.
const MARK_CARRIERS = [
  "icon-square.svg",
  "icon-square-small.svg",
  "play-adaptive-foreground.svg",
  "splash.svg",
] as const;

// Masters that keep the lit ember node. icon-square-small is deliberately
// EXCLUDED — it applies the small-optics cut (ember drops out ≤24px tiers).
const EMBER_CARRIERS = [
  "icon-square.svg",
  "play-adaptive-foreground.svg",
  "splash.svg",
] as const;

const INK_FIELDS = [
  "icon-square.svg",
  "icon-square-small.svg",
  "play-adaptive-background.svg",
  "splash.svg",
] as const;

const ALL_MASTERS = [...new Set([...MARK_CARRIERS, ...INK_FIELDS])];

const read = (name: string) => readFileSync(join(DIR, name), "utf8");

describe("store asset masters", () => {
  it("every master is an svg with no text (owner lock: mark only)", () => {
    for (const name of ALL_MASTERS) {
      const svg = read(name);
      expect(svg, name).toContain('xmlns="http://www.w3.org/2000/svg"');
      expect(svg, name).not.toMatch(/<text[\s>]/);
      expect(svg, name).not.toMatch(/<tspan[\s>]/);
    }
  });

  it("mark carriers draw the canonical coral Clink polygons (no retired Crossing arms)", () => {
    for (const name of MARK_CARRIERS) {
      const svg = read(name);
      // The two tapered pint-glass arms, as filled polygons in coral.
      expect(svg, name).toContain(`points="${CLINK_ARM_A}"`);
      expect(svg, name).toContain(`points="${CLINK_ARM_B}"`);
      expect(svg, name).toContain(`fill="${OG.coral}"`);
      // Filled polygons, never the retired stroked Crossing arms.
      expect(svg, name).toMatch(/<polygon[\s>]/);
      expect(svg, name).not.toContain("M18.5 18.5 L45.5 45.5");
      expect(svg, name).not.toContain("M45.5 18.5 L18.5 45.5");
    }
  });

  it("ember carriers light the coral-bright node at centre", () => {
    for (const name of EMBER_CARRIERS) {
      const svg = read(name);
      expect(svg, name).toContain('cx="32" cy="32" r="3.2"');
      expect(svg, name).toContain(`fill="${OG.coralBright}"`);
    }
  });

  it("small-optics cut: icon-square-small drops the ember, arms carry alone", () => {
    const small = read("icon-square-small.svg");
    // Arms present…
    expect(small).toContain(`points="${CLINK_ARM_A}"`);
    expect(small).toContain(`points="${CLINK_ARM_B}"`);
    // …ember gone (no node circle, no coral-bright at all)…
    expect(small).not.toMatch(/<circle[\s>]/);
    expect(small).not.toContain(OG.coralBright);
    // …and no glow gradient (mud at these sizes).
    expect(small).not.toMatch(/<radialGradient[\s>]/);
  });

  it("field masters sit on ink-deep", () => {
    for (const name of INK_FIELDS) {
      expect(read(name), name).toContain(`fill="${OG.inkDeep}"`);
    }
  });

  it("adaptive background stays flat: no mark, no gradient (parallax layer)", () => {
    const svg = read("play-adaptive-background.svg");
    expect(svg).not.toMatch(/<polygon[\s>]/);
    expect(svg).not.toMatch(/<path[\s>]/);
    expect(svg).not.toMatch(/<radialGradient[\s>]/);
  });
});
