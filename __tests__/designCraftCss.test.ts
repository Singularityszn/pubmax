import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const read = (file: string): string => readFileSync(join(process.cwd(), file), "utf8");

const globalCss = read("app/globals.css");
const themeCss = read("app/theme.css");
const mobileCss = read("components/mobile/mobileMapShell.css");
const landingCss = read("components/landing/landing.css");
const venueCss = read("components/map/venueSheet.css");
const pubMapSource = read("components/PubMap.tsx");
const springDrawerSource = read("components/map/SpringDrawer.tsx");
const legacyDragSource = read("components/map/useSheetDrag.ts");
const evidence = read("docs/design-craft-d1-d8-evidence.md");

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
      /\.mobileSharedSheet\.mapDrawer\s*{[^}]*background:\s*var\(--sheet-material\);[^}]*backdrop-filter:\s*blur\(20px\) saturate\(1\.08\);[^}]*contain:\s*layout paint/,
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

describe("responsive spring ownership", () => {
  it("isolates every inline drawer spring from PubMap and covers tablet sheets", () => {
    expect(pubMapSource).toContain(
      'import SpringDrawer from "@/components/map/SpringDrawer"',
    );
    expect(pubMapSource).not.toContain("useDrawerSpring");
    expect(springDrawerSource).toContain(
      'const TABLET_SHEET_QUERY = "(max-width: 768px)"',
    );
    expect(springDrawerSource).toContain(
      'data-spring-axis={tabletSheet ? "vertical" : "horizontal"}',
    );
    expect(legacyDragSource).toContain(
      "const SHEET_GESTURE_MIN_WIDTH = 641",
    );
    expect(legacyDragSource).toContain(
      "const SHEET_GESTURE_MAX_WIDTH = 768",
    );
    expect(globalCss).toMatch(
      /\.mapDrawer\.springDrawer\.left\.open\.sheet-half\[data-spring-axis="vertical"\][\s\S]*?transform:\s*var\(--drawer-spring-transform\)\s*!important/,
    );
  });

  it("retains drawer content through the closing spring", () => {
    expect(springDrawerSource).toContain(
      "{open ? children : retainedChildren}",
    );
    expect(springDrawerSource).toContain(
      "onRest: open ? undefined : clearRetainedChildren",
    );
    expect(springDrawerSource).toContain(
      'const presentationClassName = open || retainedChildren !== null',
    );
    expect(springDrawerSource).toContain(
      'className={`springDrawer ${className ?? ""}${presentationClassName}`.trim()}',
    );
    expect(springDrawerSource).toContain("inert={open ? undefined : true}");
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

describe("pointer-down feedback", () => {
  it("removes tap delay from shared controls and responds while sheet handles are held", () => {
    expect(globalCss).toMatch(
      /button,[\s\S]*?a\[data-pressable\],[\s\S]*?\.pressable\s*{[^}]*touch-action:\s*manipulation/,
    );
    expect(venueCss).toMatch(
      /\.venueSheetGrabZone:active \.venueSheetGrab,[\s\S]*?\.sheet-dragging \.venueSheetGrab\s*{[^}]*background:/,
    );
    expect(mobileCss).toMatch(
      /\.mobileSharedSheetDetent:active \.mobileSharedSheetGrab,[\s\S]*?\.sheet-dragging \.mobileSharedSheetGrab\s*{[^}]*background:/,
    );
  });

  it("composes press scale with existing positioning transforms", () => {
    const pressFeedback =
      globalCss.match(
        /@media \(prefers-reduced-motion: no-preference\)\s*{([\s\S]*?)\n}/,
      )?.[1] ?? "";
    expect(pressFeedback).toMatch(
      /button:not\(\[data-no-press\]\):not\(:disabled\):active,[\s\S]*?scale:\s*var\(--press-scale\)/,
    );
    expect(pressFeedback).not.toMatch(/transform:\s*scale\(/);
  });

  it("gates handle compression behind reduced-motion preference", () => {
    expect(venueCss).toMatch(
      /@media \(prefers-reduced-motion: no-preference\)\s*{[\s\S]*?\.venueSheetGrabZone:active \.venueSheetGrab,[\s\S]*?transform:\s*scaleX\(/,
    );
    expect(mobileCss).toMatch(
      /@media \(max-width: 640px\) and \(prefers-reduced-motion: no-preference\)\s*{[\s\S]*?\.mobileSharedSheetDetent:active \.mobileSharedSheetGrab,[\s\S]*?scaleX\(/,
    );
  });
});

describe("price signature and map policy evidence", () => {
  it("keeps static price tilt outside motion preference gates", () => {
    expect(globalCss).toMatch(
      /\.ink-stamp--tilt\s*{[^}]*transform:\s*rotate\(var\(--ink-stamp-tilt\)\);[^}]*}\s*body/,
    );
  });

  it("records the unchanged cluster collision padding precisely", () => {
    expect(evidence).toMatch(
      /Cluster-count collision padding remains 10\s+pixels/,
    );
  });
});
