import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const read = (file: string): string => readFileSync(join(process.cwd(), file), "utf8");

const globalCss = read("app/globals.css");
const themeCss = read("app/theme.css");
const mobileCss = read("components/mobile/mobileMapShell.css");
const landingCss = read("components/landing/landing.css");
const venueCss = read("components/map/venueSheet.css");

describe("sheet material", () => {
  it("ships one dark-first translucent material for desktop and phone sheets", () => {
    expect(globalCss).toMatch(/--sheet-material:\s*color-mix\([^;]+transparent\)/);
    expect(themeCss).toMatch(
      /html\[data-theme="dark"\]\s*{[\s\S]*?--sheet-material:\s*color-mix\([^;]+transparent\)/,
    );
    expect(globalCss).toMatch(
      /\.mapDrawer\s*{[^}]*background:\s*var\(--sheet-material\);[^}]*backdrop-filter:\s*blur\(20px\) saturate\(1\.08\)/,
    );
    expect(mobileCss).toMatch(
      /\.mobileSharedSheet\.mapDrawer\s*{[^}]*background:\s*var\(--sheet-material\);[^}]*backdrop-filter:\s*blur\(20px\) saturate\(1\.08\)/,
    );
  });

  it("falls back to an opaque material for transparency and contrast preferences", () => {
    expect(globalCss).toMatch(
      /@media \(prefers-reduced-transparency: reduce\), \(prefers-contrast: more\)\s*{[\s\S]*?\.mapDrawer\s*{[^}]*background:\s*var\(--sheet-material-solid\);[^}]*backdrop-filter:\s*none/,
    );
    expect(mobileCss).toMatch(
      /@media \(max-width: 640px\) and \(prefers-reduced-transparency: reduce\)\s*{[\s\S]*?\.mobileSharedSheet\.mapDrawer\s*{[^}]*background:\s*var\(--sheet-material-solid\);[^}]*backdrop-filter:\s*none/,
    );
  });
});

describe("surface and type hierarchy", () => {
  it("makes one landing signal dominant and two supporting rows subordinate", () => {
    expect(landingCss).toMatch(
      /\.lpSignalGrid article:first-child\s*{[^}]*grid-row:\s*1\s*\/\s*span 2/,
    );
    expect(landingCss).toMatch(
      /\.lpSignalGrid article:not\(:first-child\)\s*{[^}]*min-height:\s*0/,
    );
    expect(landingCss).toMatch(
      /\.lpSignalGrid article:first-child h3\s*{[^}]*font-size:\s*clamp\(/,
    );
    expect(landingCss).toMatch(
      /\.lpButtonQuiet\s*{[^}]*background:\s*transparent;[^}]*border-color:\s*transparent/,
    );
  });

  it("removes nested panel chrome and makes venue names the primary type", () => {
    const panel = venueCss.match(/\.venueTabPanel\s*{([^}]*)}/)?.[1] ?? "";
    expect(panel).toMatch(/border:\s*0/);
    expect(panel).toMatch(/background:\s*transparent/);
    expect(panel).toMatch(/box-shadow:\s*none/);
    expect(venueCss).toMatch(
      /\.venueInspector > h3\s*{[^}]*font-size:\s*clamp\([^;]+;[^}]*font-weight:\s*740/,
    );
    expect(mobileCss).toMatch(
      /\.mobileSharedSheetHeader h2\s*{[^}]*font-size:\s*clamp\([^;]+;[^}]*font-weight:\s*720/,
    );
    expect(mobileCss).toMatch(
      /\.mobileVenuePeekSummary\s*{[^}]*border-inline:\s*0;[^}]*border-radius:\s*0;[^}]*background:\s*transparent/,
    );
    expect(venueCss).toMatch(
      /\.venueTabPanel \.contributorPrice\s*{[^}]*border-inline:\s*0;[^}]*background:\s*transparent;[^}]*box-shadow:\s*none/,
    );
  });
});
