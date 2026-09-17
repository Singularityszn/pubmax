import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// Two pieces of chrome that read as debris on a phone (desktop taste gate,
// finding M7). Both were invisible to a desktop browser, so both are held in
// the shipped CSS, the same house pattern as mobileChromeFit.test.ts.
//
//  - MapLibre's control group parked a bare dark square under the round TfL
//    chip, over cluster pins. It is a control, so it wears the lane's shape.
//  - The map key's three closed sections carried no affordance at all:
//    `display: flex` on a <summary> drops the browser's disclosure triangle, so
//    "Pin shapes", "Dots and rings" and "Routes" read as headings over nothing.

const read = (file: string): string => readFileSync(join(process.cwd(), file), "utf8");

const mobileMapCss = read("components/mobile/mobileMapShell.module.css");
const mapKeyCss = read("components/map/mapKey.module.css");
const cameraControlsCss = read("components/map/mapCameraControls.module.css");
const canvasSource = read("components/PubMapCanvas.tsx");

/**
 * Every declaration that lands on `selector`, from each rule that names it.
 *
 * Selector-list rules are the reason this is not one regex: `.mapKeySection h3,
 * .mapKeyDetails summary { … }` styles the summary too, and a naive match on
 * the second name would read the shared rule as the whole answer.
 */
function rule(css: string, selector: string): string {
  const flat = css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/@media[^{]*\{/g, "");
  const declarations: string[] = [];
  for (const [, list, body] of flat.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (list.split(",").some((name) => name.trim() === selector)) {
      declarations.push(body);
    }
  }
  return declarations.join("\n");
}

describe("phone map compass — a control, not a box", () => {
  const appCompass = rule(
    mobileMapCss,
    ":global(.appShell .mapStage .mapCameraControls .mapCompassBtn)",
  );
  const nativeGroup = rule(mobileMapCss, ":global(.appShell .mapStage .maplibregl-ctrl-top-right)");

  it("wears the round 44px shape the rest of the lane uses", () => {
    expect(appCompass).toMatch(/border-radius:\s*50%/);
    expect(appCompass).toMatch(/width:\s*44px/);
    expect(appCompass).toMatch(/height:\s*44px/);
  });

  // MapLibre's compass is off at the source now (PubMapCanvas), and its zoom
  // buttons were already hidden here, so the group left behind is an empty
  // round box parked under the TfL chip — the very debris this file names.
  it("takes away the native group it left with nothing in it", () => {
    expect(nativeGroup).toMatch(/display:\s*none/);
  });

  it("keeps a compass on the phone, which is the only way back from a rotation", () => {
    expect(mobileMapCss).toContain(".mapCompassBtn");
    expect(mobileMapCss).not.toMatch(
      /\.mapCameraControls \.mapCompassBtn\s*{[^}]*display:\s*none/,
    );
  });
});

describe("wide-screen camera chips — reachable, not under the toolbar", () => {
  // app/globals.css leaves room for ONE 44px chip above the search toolbar
  // (--map-overlay-top 108px, --map-top-clearance 159px). A second row lands
  // inside the toolbar's band, where its right end paints over the chip and
  // takes the tap: measured at 1024 and 1280 with the city switcher on top of
  // the compass. Survivable while that row was the route-only Recenter chip;
  // not survivable now the compass is always there.
  it("lays the chips out as a row on a wide screen", () => {
    const row = rule(cameraControlsCss, ":global(.mapCameraControls)");
    expect(row).toMatch(/grid-auto-flow:\s*column/);
    expect(cameraControlsCss).toMatch(/@media \(min-width:\s*901px\)/);
  });

  it("is loaded by the canvas that draws the chips", () => {
    expect(canvasSource).toContain('import "./map/mapCameraControls.module.css"');
  });

  // A 44px circle in the phone's map-edge lane cannot hold a word: it wrapped
  // out of the button and off the right of the screen.
  it("takes the word off the phone chip and leaves the name on the button", () => {
    expect(canvasSource).toContain('className="mapCompassBtnLabel"');
    expect(canvasSource).toMatch(/aria-label=\{compassResetLabel\(/);
    expect(
      rule(mobileMapCss, ":global(.appShell .mapStage .mapCameraControls .mapCompassBtn .mapCompassBtnLabel)"),
    ).toMatch(/display:\s*none/);
  });
});

describe("map key sections — a closed row says it opens", () => {
  const summary = rule(mapKeyCss, ".mapKeyDetails summary");
  const chevron = rule(mapKeyCss, ".mapKeyDetails summary::after");
  const openChevron = rule(mapKeyCss, ".mapKeyDetails[open] summary::after");

  it("draws a chevron on every summary row", () => {
    expect(chevron).toMatch(/content:\s*""/);
    expect(chevron).toMatch(/border-right:/);
    expect(chevron).toMatch(/border-bottom:/);
    expect(chevron).toMatch(/rotate\(45deg\)/);
    // The row is a flex line, so the chevron needs its own end of it.
    expect(summary).toMatch(/justify-content:\s*space-between/);
    expect(summary).toMatch(/min-height:\s*44px/);
  });

  it("turns the chevron when the section is open", () => {
    expect(openChevron).toMatch(/rotate\(-135deg\)/);
    expect(openChevron).not.toBe(chevron);
  });

  it("hides the browser markers it replaced, in both engines", () => {
    expect(summary).toMatch(/list-style:\s*none/);
    expect(mapKeyCss).toMatch(
      /\.mapKeyDetails summary::-webkit-details-marker\s*{[^}]*display:\s*none/,
    );
  });
});
