import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { OG } from "@/lib/ogBrand";

// Contract for the store visual identity masters (issue #440): crossing mark
// on ink dark with the candle-coral accent, no text, hexes never drifting from
// the OG brand kit, geometry never drifting from the canonical 64-grid
// Crossing. These are the masters scripts/gen-store-assets.mjs renders the
// whole store PNG set from, so a drift here ships to both stores.

const DIR = join(process.cwd(), "public", "store-assets");

const MARK_CARRIERS = [
  "icon-square.svg",
  "icon-square-small.svg",
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

  it("mark carriers draw the canonical coral crossing with the lit node", () => {
    for (const name of MARK_CARRIERS) {
      const svg = read(name);
      expect(svg, name).toContain('d="M18.5 18.5 L45.5 45.5"');
      expect(svg, name).toContain('d="M45.5 18.5 L18.5 45.5"');
      expect(svg, name).toContain(`stroke="${OG.coral}"`);
      expect(svg, name).toContain(`fill="${OG.coralBright}"`);
    }
  });

  it("field masters sit on ink-deep", () => {
    for (const name of INK_FIELDS) {
      expect(read(name), name).toContain(`fill="${OG.inkDeep}"`);
    }
  });

  it("adaptive background stays flat: no mark, no gradient (parallax layer)", () => {
    const svg = read("play-adaptive-background.svg");
    expect(svg).not.toMatch(/<path[\s>]/);
    expect(svg).not.toMatch(/<radialGradient[\s>]/);
  });

  it("small-size variant thickens the optics for the 29px tier", () => {
    const small = read("icon-square-small.svg");
    expect(small).toContain('stroke-width="10.5"');
    expect(small).not.toMatch(/<radialGradient[\s>]/);
    expect(read("icon-square.svg")).toContain('stroke-width="8.5"');
  });
});
