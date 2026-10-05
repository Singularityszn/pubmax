import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { defined } from "@/__tests__/helpers/defined";

const read = (file: string): string => readFileSync(join(process.cwd(), file), "utf8");

const globalCss = read("app/globals.css");
const themeCss = read("app/theme.css");
const mobileCss = read("components/mobile/mobileMapShell.css");
const createFabCss = read("components/nav/createFab.css");
const landingCss = read("components/landing/landing.css");
const venueCss = read("components/map/venueSheet.css");
const evidence = read("docs/design-craft-d1-d8-evidence.md");

function cssFilesUnder(directory: string): string[] {
  return readdirSync(join(process.cwd(), directory), { withFileTypes: true })
    .flatMap((entry) => {
      const relativePath = join(directory, entry.name);
      return entry.isDirectory()
        ? cssFilesUnder(relativePath)
        : entry.isFile() && entry.name.endsWith(".css")
          ? [relativePath]
          : [];
    });
}

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

describe("area picker surface tokens", () => {
  it("keeps the desktop picker on the sheet radius and shadow vocabulary", () => {
    const chooseAreaCss = read("components/map/chooseAreaSheet.css");
    const dialog = chooseAreaCss.match(/\.chooseAreaDesktop\s*\{([^}]*)\}/)?.[1] ?? "";

    expect(dialog).toMatch(/border-radius:\s*var\(--radius-lg\)/);
    expect(dialog).toMatch(/box-shadow:\s*var\(--shadow\)/);
    expect(dialog).not.toContain("--radius-md");
    expect(dialog).not.toContain("--shadow-md");
  });
});

describe("surface and type hierarchy", () => {
  it("gives the landing one primary through the Screen primitive and no second button family", () => {
    // The relaunch landing (issue #1354) paints its one primary through
    // components/ui/screen.css. The old landing button family, the signal
    // grid and the glass nav are gone and must not creep back.
    expect(landingCss).not.toMatch(/\.lpButton(Primary|Quiet)?\s*{/);
    expect(landingCss).not.toMatch(/\.lpSignalGrid/);
    expect(landingCss).not.toMatch(/backdrop-filter/);
    expect(landingCss).toMatch(/\.lpHero\s*{[^}]*min-height:\s*100dvh/);
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
  it("keeps shared press feedback below utility and component owners", () => {
    const pressStart = globalCss.indexOf("/* ── Global press feedback");
    const pressEnd = globalCss.indexOf("\n.loadingShell", pressStart);
    const pressFeedback = globalCss.slice(pressStart, pressEnd);
    const layerStart = pressFeedback.indexOf("@layer base");
    const bodyStart = pressFeedback.indexOf("{", layerStart);
    let depth = 0;
    let layerEnd = -1;
    for (let index = bodyStart; index < pressFeedback.length; index += 1) {
      if (pressFeedback[index] === "{") depth += 1;
      if (pressFeedback[index] === "}") depth -= 1;
      if (depth === 0) {
        layerEnd = index + 1;
        break;
      }
    }
    const baseLayer = pressFeedback.slice(layerStart, layerEnd);

    expect(baseLayer).toMatch(
      /@layer base\s*{[\s\S]*touch-action:\s*manipulation;[\s\S]*transition:\s*scale[\s\S]*scale:\s*var\(--shared-press-scale,\s*var\(--press-scale\)\)/,
    );
    expect(pressFeedback.slice(layerEnd).trim()).toBe("");
  });

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
      /:where\(\s*button:not\(\[data-no-press\]\):not\(:disabled\),[\s\S]*?\.pressable\s*\)\s*{[^}]*transition:\s*scale/,
    );
    expect(pressFeedback).toMatch(
      /button:not\(\[data-no-press\]\):not\(:disabled\):active,[\s\S]*?scale:\s*var\(--shared-press-scale,\s*var\(--press-scale\)\)/,
    );
    expect(pressFeedback).not.toMatch(/transform:\s*scale\(/);
  });

  it("gives every pressed control one scale owner", () => {
    const offenders: string[] = [];
    for (const relativePath of [
      ...cssFilesUnder("app"),
      ...cssFilesUnder("components"),
    ]) {
      const source = read(relativePath);
      for (const match of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const selector = defined(match[1]);
        const declarations = match[2];
        const ownsActiveState = selector
          .split(",")
          .some((branch) => {
            const selectorBranch = branch.trim();
            const activeIndex = selectorBranch.lastIndexOf(":active");
            return (
              activeIndex >= 0 &&
              !/[ >+~]/.test(
                selectorBranch.slice(activeIndex + ":active".length),
              )
            );
          });
        if (
          ownsActiveState &&
          /transform\s*:[^;]*\bscale(?:X|Y|3d)?\(/.test(defined(declarations)) &&
          !/--shared-press-scale\s*:\s*1/.test(defined(declarations))
        ) {
          offenders.push(`${relativePath}: ${selector.trim()}`);
        }
      }
    }
    expect(offenders).toEqual([]);
    expect(mobileCss).toMatch(
      /\.mobileSharedSheetDetent:active\s*{[^}]*--shared-press-scale:\s*1/,
    );
    // The emphasized compose action left the tab row for the floating create
    // control, and it still owns its own press, so it still says so by name.
    expect(createFabCss).toMatch(
      /\.createFab:active\s*{[^}]*--shared-press-scale:\s*1/,
    );
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
  it("leans no price and bevels none", () => {
    // Captain 6 Sep 2026: the plaque was an engraved plate with a -1.5deg
    // tilt, standing beside body copy and pill buttons. There is no tilt
    // class left to gate, and the plaque paints no inset shadow.
    expect(globalCss).not.toMatch(/\.ink-stamp--tilt\s*{/);
    const plaque = /\.price-plaque \{[\s\S]*?\}/.exec(globalCss)?.[0] ?? "";
    expect(plaque).toContain("box-shadow: none;");
    expect(plaque).not.toContain("--price-plaque-shine");
    // A price takes the button's corner RATIO, never its raw number: the
    // control token on a 28px box renders a stadium, and the stadium is the
    // pill this system reserves for icon controls and tab segments.
    expect(plaque).toContain("border-radius: var(--radius, 8px);");
    expect(plaque).not.toContain("border-radius: var(--control-radius");
  });

  it("records the unchanged cluster collision padding precisely", () => {
    expect(evidence).toMatch(
      /Cluster-count collision padding remains 10\s+pixels/,
    );
  });
});
