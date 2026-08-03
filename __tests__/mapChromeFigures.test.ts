import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { formatPriceChipGbp, QUICK_ADD_PRICES_GBP } from "@/lib/spill";

// D7 — two pieces of small dirt the taste gate found in map chrome, kept apart
// here because both are about what a control PRINTS.
//
//   1. The quick-add price chips carried "£6.9": the 69 gag standing beside real
//      logged figures, which docs/VOICE.md bans outright, and printed with one
//      decimal where a price has two.
//   2. The map carried two controls both reading "London" — the camera-fit pill
//      and the toolbar's city dropdown. The name belongs to the control that can
//      change it.

const read = (file: string): string => readFileSync(join(process.cwd(), file), "utf8");

describe("quick-add price presets", () => {
  it("offers only round price points, so no figure is a joke", () => {
    for (const price of QUICK_ADD_PRICES_GBP) {
      expect(
        Math.round(price * 100) % 50,
        `£${price} is not a round price point`,
      ).toBe(0);
    }
  });

  it("prints every preset with both pence", () => {
    for (const price of QUICK_ADD_PRICES_GBP) {
      expect(formatPriceChipGbp(price)).toMatch(/^\d+\.\d{2}$/);
    }
    expect(formatPriceChipGbp(4)).toBe("4.00");
    expect(formatPriceChipGbp(4.5)).toBe("4.50");
  });

  it("prints the chip and sets the field from the same figure", () => {
    const composer = read("components/map/composer/ComposerFields.tsx");
    expect(composer).toContain("const label = formatPriceChipGbp(price);");
    expect(composer).not.toMatch(/const label = formatPriceGbp\(price\)/);
  });
});

describe("map chrome names a city once", () => {
  it("keeps the city name on the switcher, not on the camera-fit control", () => {
    const canvas = read("components/PubMapCanvas.tsx");
    const button =
      canvas.match(/className="mapFitLondonBtn"[\s\S]*?<\/button>/)?.[0] ?? "";
    expect(button).toContain("Show all");
    // A bare `{cityDisplayName}` is the PRINTED name; `${cityDisplayName}`
    // inside the accessible name is the one that may stay.
    expect(button).not.toMatch(/(?<!\$)\{cityDisplayName\}/);
    // The accessible name still says which city, and leads with the visible
    // words so a voice command matching the label still reaches the control.
    expect(button).toMatch(/aria-label=\{`Show all of \$\{cityDisplayName\}`\}/);
  });
});
