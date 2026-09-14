import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const globalCss = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");

describe("analytics consent clearance", () => {
  it("reserves body foot room while the fixed consent bar is mounted", () => {
    expect(globalCss).toMatch(
      /@media \(min-width:\s*641px\)\s*{[^}]*body:has\(\.analyticsConsentPrompt\)\s*{[^}]*padding-bottom:\s*calc\(\s*var\(--analytics-consent-clearance,\s*72px\)/,
    );
    expect(globalCss).toMatch(
      /body:has\(\.analyticsConsentPrompt\)\s*{[^}]*max\(12px,\s*env\(safe-area-inset-bottom\)\)/,
    );
  });

  it("reserves mobile foot room above the tab bar while the consent card is mounted", () => {
    expect(globalCss).toMatch(
      /@media \(max-width:\s*640px\)\s*{[^}]*body:has\(\.analyticsConsentPrompt\):has\(\.mobileTabBar,\s*\.mobileTabBarClearance\)\s*{[^}]*padding-bottom:\s*calc\(\s*var\(--tabbar-h,\s*64px\)\s*\+\s*env\(safe-area-inset-bottom,\s*0px\)\s*\+\s*var\(--analytics-consent-mobile-clearance,\s*56px\)/,
    );
    expect(globalCss).toMatch(
      /body:has\(\.analyticsConsentPrompt\):not\(:has\(\.mobileTabBar,\s*\.mobileTabBarClearance\)\)\s*{[^}]*var\(--analytics-consent-mobile-clearance,\s*56px\)/,
    );
  });

  it("keeps the consent prompt on a fixed bottom layer", () => {
    expect(globalCss).toMatch(
      /\.analyticsConsentPrompt\s*{[^}]*position:\s*fixed/,
    );
  });

  // DOCKED, NEVER FLOATING (PlanAstra section 3). The card used to be an
  // inset, blurred, shadowed panel hovering over the answer. These four
  // declarations are what make it a strip pinned to the chrome, and any one of
  // them going back is the floating panel again.
  it("docks the card full bleed to both edges", () => {
    const base = globalCss.match(/\n\.analyticsConsentPrompt\s*{([^}]*)}/)?.[1] ?? "";
    expect(base).toMatch(/left:\s*0/);
    expect(base).toMatch(/right:\s*0/);
    expect(base).toMatch(/max-width:\s*none/);
    expect(base).toMatch(/width:\s*auto/);
  });

  it("paints no overlay and no dim over what it covers", () => {
    const base = globalCss.match(/\n\.analyticsConsentPrompt\s*{([^}]*)}/)?.[1] ?? "";
    expect(base).toMatch(/border-radius:\s*0/);
    expect(base).toMatch(/background:\s*var\(--panel-raised\)/);
    expect(base).not.toMatch(/backdrop-filter/);
    expect(base).not.toMatch(/box-shadow/);
  });

  it("sits flush on the tab bar rather than 8px above it", () => {
    // The gap is what made the card read as a panel over the page; the bottom
    // safe-area inset belongs to the bar underneath, never to the card.
    expect(globalCss).toMatch(
      /\.analyticsConsentPrompt\s*{\s*bottom:\s*calc\(var\(--tabbar-h,\s*64px\)\s*\+\s*env\(safe-area-inset-bottom\)\)/,
    );
  });

  // NO BAND ON THE MAP (site audit 13 Sep 2026). A square, fully opaque card
  // over the WebGL map made the compositor skip the canvas under the card's
  // rect mirrored in y, so a band of bare map background stood behind the chip
  // row. Rendered proof: e2e/map-consent-canvas-band.spec.ts.
  it("keeps the card from occluding a map canvas", () => {
    const rule = globalCss.match(
      /body:has\(\.maplibregl-canvas\) \.analyticsConsentPrompt\s*{([^}]*)}/,
    )?.[1] ?? "";
    const opacity = Number.parseFloat(rule.match(/opacity:\s*([\d.]+)/)?.[1] ?? "1");
    expect(opacity).toBeLessThan(1);
    expect(opacity).toBeGreaterThanOrEqual(0.99);
  });

  it("keeps the full disclosure visible on the map", () => {
    const mapParagraph = globalCss.match(
      /body:has\(\.mobilePlanActivation\) \.analyticsConsentPrompt p\s*{([^}]*)}/,
    )?.[1] ?? "";
    expect(mapParagraph).not.toMatch(/line-clamp|overflow:\s*hidden/);
  });
});
