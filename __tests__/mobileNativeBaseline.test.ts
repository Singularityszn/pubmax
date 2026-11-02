// THE APP FEELS INSTALLED, NOT EMBEDDED (design plan step 0.6, from the
// mobile-native list in docs/plans/DESIGN_UX_PLAN.md section 10). The app
// already had the 16px input floor, safe areas, a theme colour per scheme and
// hover gated to mouse screens. Four gaps remained, read from the code:
//
//   1. the grey tap flash was off on 14 single sheets, not the whole app;
//   2. nothing stopped pull-to-refresh on the map;
//   3. the Android keyboard covered the pinned composers, because the layout
//      viewport kept its height behind the keys;
//   4. one phone sheet was 82vh tall, the height with the browser bars hidden.
//
// These pins hold the fixes. Each still needs a look on a real phone.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..");

function read(relative: string): string {
  return readFileSync(join(ROOT, relative), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
}

/** The body of the first rule whose selector list is exactly `selector`. */
function ruleBody(css: string, selector: string): string {
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if ((match[1] ?? "").trim() === selector) return match[2] ?? "";
  }
  return "";
}

describe("the mobile-native baseline", () => {
  it("never flashes the tap highlight, on any page", () => {
    expect(ruleBody(read("app/globals.css"), "html")).toMatch(/-webkit-tap-highlight-color:\s*transparent;/);
  });

  it("stops pull-to-refresh and the page bounce while the map shell is on the page", () => {
    expect(ruleBody(read("components/mobile/mobileMapShell.css"), "html:has(.appShell)")).toMatch(
      /overscroll-behavior:\s*none;/,
    );
  });

  it("lets the Android keyboard resize the layout viewport", () => {
    const layout = readFileSync(join(ROOT, "app/layout.tsx"), "utf8");
    const start = layout.indexOf("export const viewport: Viewport = {");
    const block = layout.slice(start, layout.indexOf("};", start));
    expect(block).toContain('interactiveWidget: "resizes-content",');
  });

  it("sizes the phone map drawer by the visible viewport, with vh only as the fallback", () => {
    const globals = read("app/globals.css");
    const drawer = [...globals.matchAll(/\.mapDrawer\s*\{([^{}]*)\}/g)]
      .map((match) => match[1] ?? "")
      .find((body) => /max-height:\s*82/.test(body));
    expect(drawer).toBeDefined();
    const heights = [...(drawer ?? "").matchAll(/max-height:\s*([^;]+);/g)].map((match) => match[1]);
    expect(heights).toEqual(["82vh", "82dvh"]);
  });
});
