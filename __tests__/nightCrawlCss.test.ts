import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const css = readFileSync(join(process.cwd(), "components/plan/nightCrawl.module.css"), "utf8");
const tsx = readFileSync(join(process.cwd(), "components/plan/NightCrawlMode.tsx"), "utf8");
const navCss = readFileSync(join(process.cwd(), "components/nav/mobileNav.css"), "utf8");
const consentCss = readFileSync(join(process.cwd(), "components/AnalyticsConsent.module.css"), "utf8");

describe("Night-crawl surface conformance (U7)", () => {
  it("is an OLED-dark surface (ink-dark paper), not the light paper token", () => {
    expect(css).toMatch(/--nc-paper:\s*#070b0a/i);
    expect(css).toMatch(/\.nightCrawl\s*{[\s\S]*?background:[\s\S]*?var\(--nc-paper\)/);
  });

  it("makes the arrive slab the one giant target (>= 64px tall) and skip a demoted 62px+ secondary", () => {
    const arrive = css.match(/\.nightCrawlArrive\s*{([\s\S]*?)}/)?.[1] ?? "";
    const skip = css.match(/\.nightCrawlSkip\s*{([\s\S]*?)}/)?.[1] ?? "";
    const arriveMin = Number(arrive.match(/min-height:\s*(\d+)px/)?.[1] ?? "0");
    const skipMin = Number(skip.match(/min-height:\s*(\d+)px/)?.[1] ?? "0");
    expect(arriveMin).toBeGreaterThanOrEqual(64);
    expect(skipMin).toBeGreaterThanOrEqual(62);
    // arrive is the dominant slab — it must not be narrower than skip
    expect(arrive).toMatch(/flex:\s*1\.6/);
  });

  it("pins a get-home escape hatch at 64px+ that always renders", () => {
    const escape = css.match(/\.nightCrawlEscape\s*{([\s\S]*?)}/)?.[1] ?? "";
    expect(Number(escape.match(/min-height:\s*(\d+)px/)?.[1] ?? "0")).toBeGreaterThanOrEqual(64);
    // Rendered unconditionally in the surface (outside every conditional branch).
    expect(tsx).toMatch(/nightCrawlEscape[\s\S]*Get me home/);
    expect(tsx).toContain("tfl.gov.uk/plan-a-journey");
  });

  it("respects reduced motion (kills the entrance + press transforms)", () => {
    const query = css.match(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*{([\s\S]*?)\n}/)?.[1] ?? "";
    expect(query).toMatch(/\.nightCrawl\s*{\s*animation:\s*none/);
    expect(query).toMatch(/transform:\s*none/);
  });

  it("does not adopt the quarantined party font (stays out of the third-family budget)", () => {
    expect(css).not.toContain("--font-party");
    expect(tsx).not.toContain("--font-party");
  });

  it("keeps thumb-sized touch targets on the exit control (44px+)", () => {
    const exit = css.match(/\.nightCrawlExit\s*{([\s\S]*?)}/)?.[1] ?? "";
    expect(Number(exit.match(/min-height:\s*(\d+)px/)?.[1] ?? "0")).toBeGreaterThanOrEqual(44);
  });

  it("takes the tab bar and the consent card off its foot while it is engaged", () => {
    // verify-preview-4 RED 2 (5 Sep 2026): at 320x568 the phone tab bar owned
    // the centre of the lower "Get me home" slab, and the consent card owned
    // "We are here". The surface is fixed and full-screen, so both step aside
    // for it the way they do for a venue sheet. e2e/night-mode-chrome.spec.ts
    // proves the rendered taps.
    const barRule = navCss.match(/body:has\(\.nightCrawl\) \.mobileTabBar\s*{([^}]*)}/)?.[1]
      ?? navCss.match(/[^}]*body:has\(\.nightCrawl\) \.mobileTabBar[^{]*{([^}]*)}/)?.[1]
      ?? "";
    expect(barRule).toMatch(/pointer-events:\s*none/);
    expect(barRule).toMatch(/transform:\s*translateY\(110%\)/);
    const cardRule = consentCss.match(/[^}]*body:has\(:global\(\.nightCrawl\)\) :global\(\.analyticsConsentPrompt\)[^{]*{([^}]*)}/)?.[1] ?? "";
    expect(cardRule).toMatch(/visibility:\s*hidden/);
    expect(cardRule).toMatch(/pointer-events:\s*none/);
  });
});
