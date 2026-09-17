import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const globalCss = readFileSync(join(process.cwd(), "components/AnalyticsConsent.module.css"), "utf8");

describe("analytics consent clearance", () => {
  it("reserves body foot room while the fixed consent bar is mounted", () => {
    expect(globalCss).toMatch(
      /@media \(min-width:\s*641px\)\s*{[^}]*body:has\(:global\(\.analyticsConsentPrompt\)\)\s*{[^}]*padding-bottom:\s*calc\(\s*var\(--analytics-consent-clearance,\s*72px\)/,
    );
    expect(globalCss).toMatch(
      /body:has\(:global\(\.analyticsConsentPrompt\)\)\s*{[^}]*max\(12px,\s*env\(safe-area-inset-bottom\)\)/,
    );
  });

  it("reserves mobile foot room above the tab bar while the consent card is mounted", () => {
    expect(globalCss).toMatch(
      /@media \(max-width:\s*640px\)\s*{[^}]*body:has\(:global\(\.analyticsConsentPrompt\)\):has\(:global\(\.mobileTabBar\),\s*:global\(\.mobileTabBarClearance\)\)\s*{[^}]*padding-bottom:\s*calc\(\s*var\(--tabbar-h,\s*64px\)\s*\+\s*env\(safe-area-inset-bottom,\s*0px\)\s*\+\s*var\(--analytics-consent-mobile-clearance,\s*56px\)/,
    );
    expect(globalCss).toMatch(
      /body:has\(:global\(\.analyticsConsentPrompt\)\):not\(:has\(:global\(\.mobileTabBar\),\s*:global\(\.mobileTabBarClearance\)\)\)\s*{[^}]*var\(--analytics-consent-mobile-clearance,\s*56px\)/,
    );
  });

  it("keeps the consent prompt on a fixed bottom layer", () => {
    expect(globalCss).toMatch(
      /:global\(\.analyticsConsentPrompt\)\s*{[^}]*position:\s*fixed/,
    );
  });

  // DOCKED, NEVER FLOATING (PlanAstra section 3). The card used to be an
  // inset, blurred, shadowed panel hovering over the answer. These four
  // declarations are what make it a strip pinned to the chrome, and any one of
  // them going back is the floating panel again.
  it("docks the card full bleed to both edges", () => {
    const base = globalCss.match(/\n:global\(\.analyticsConsentPrompt\)\s*{([^}]*)}/)?.[1] ?? "";
    expect(base).toMatch(/left:\s*0/);
    expect(base).toMatch(/right:\s*0/);
    expect(base).toMatch(/max-width:\s*none/);
    expect(base).toMatch(/width:\s*auto/);
  });

  it("paints no overlay and no dim over what it covers", () => {
    const base = globalCss.match(/\n:global\(\.analyticsConsentPrompt\)\s*{([^}]*)}/)?.[1] ?? "";
    expect(base).toMatch(/border-radius:\s*0/);
    expect(base).toMatch(/background:\s*var\(--panel-raised\)/);
    expect(base).not.toMatch(/backdrop-filter/);
    expect(base).not.toMatch(/box-shadow/);
  });

  it("sits flush on the tab bar rather than 8px above it", () => {
    // The gap is what made the card read as a panel over the page; the bottom
    // safe-area inset belongs to the bar underneath, never to the card.
    expect(globalCss).toMatch(
      /:global\(\.analyticsConsentPrompt\)\s*{\s*bottom:\s*calc\(var\(--tabbar-h,\s*64px\)\s*\+\s*env\(safe-area-inset-bottom\)\)/,
    );
  });

  it("keeps the full disclosure visible on the map", () => {
    const mapParagraph = globalCss.match(
      /body:has\(\.mobilePlanActivation\) \.analyticsConsentPrompt p\s*{([^}]*)}/,
    )?.[1] ?? "";
    expect(mapParagraph).not.toMatch(/line-clamp|overflow:\s*hidden/);
  });
});
