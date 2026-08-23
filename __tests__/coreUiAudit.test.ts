import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();
const landing = readFileSync(join(root, "components/landing/LandingPage.tsx"), "utf8");
const wordmark = readFileSync(join(root, "components/brand/PubmaxxWordmark.tsx"), "utf8");
const consent = readFileSync(join(root, "app/globals.css"), "utf8");
const tour = readFileSync(join(root, "components/onboarding/firstRunTour.css"), "utf8");
const planEntry = readFileSync(join(root, "components/plan/PlanDescribeFirst.tsx"), "utf8");
const planCss = readFileSync(join(root, "app/plan/plan.css"), "utf8");
const mobileMapCss = readFileSync(
  join(root, "components/mobile/mobileMapShell.css"),
  "utf8",
);
const nextConfig = readFileSync(join(root, "next.config.mjs"), "utf8");
const vercelIgnore = readFileSync(join(root, ".vercelignore"), "utf8");

describe("core UI audit fixes", () => {
  it("makes Plan tonight together the landing hero primary", () => {
    const heroPrimary = landing.match(/const heroPrimary[\s\S]*?\n  \);/)?.[0] ?? "";
    expect(heroPrimary).toMatch(
      /className="lpButton lpButtonPrimary"[\s\S]*?href="\/plan"[\s\S]*?Plan tonight together/,
    );
    expect(heroPrimary).not.toMatch(
      /className="lpButton lpButtonPrimary"[\s\S]*?href="\/near\?locate=1"[\s\S]*?Find my pint/,
    );
  });

  it("publishes the complete PUBMAXX brand to assistive technology", () => {
    expect(wordmark).toMatch(/className=\{`pubmaxxWordmark[\s\S]*?role="img"/);
    expect(wordmark).toMatch(/aria-label=\{BRAND_NAME\}/);
  });

  it("clears mobile consent with the measured 64px tab bar", () => {
    expect(consent).toMatch(/var\(--tabbar-h,\s*64px\)/);
    expect(consent).toMatch(/--analytics-consent-mobile-clearance,\s*128px/);
  });

  it("uses a distinct neutral tone for the dearest first-visit price band", () => {
    expect(tour).toMatch(/\.tourLegendRow \.mapPriceDot\.red\s*\{[\s\S]*?background:\s*color-mix\(/);
    expect(tour).not.toMatch(/\.tourLegendRow \.mapPriceDot\.red\s*\{[\s\S]*?background:\s*var\(--amber\)/);
    expect(tour).not.toMatch(/\.tourLegendRow \.mapPriceDot\.red\s*\{[\s\S]*?var\(--brick\)/);
  });

  it("keeps the plan entry placeholder readable on a phone", () => {
    expect(planEntry).toMatch(/placeholder="Quiet in Clapham for 4"/);
    expect(planEntry).not.toMatch(/placeholder="[^"]*…/);
    expect(planCss).toMatch(/@media \(max-width: 760px\)[\s\S]*?\.planPage__intro\s*\{\s*margin:\s*10px auto 10px/);
  });

  it("removes non-core map tools during first-session arrival", () => {
    expect(mobileMapCss).toMatch(
      /body:has\(\.mapArrivalCard\) \.mobileMapUtilityCorner,[\s\S]*?body:has\(\.mapArrivalCard\) \.mobileMapTonightChip,[\s\S]*?\{\s*display:\s*none;/,
    );
  });

  it("does not ship removed Next experimental options", () => {
    expect(nextConfig).not.toMatch(/\bviewTransition\s*:/);
  });

  it("keeps proof and local build artifacts out of Vercel uploads", () => {
    expect(vercelIgnore).toMatch(/^\/docs\/$/m);
    expect(vercelIgnore).toMatch(/^\/\.next-\*$/m);
    expect(vercelIgnore).toMatch(/^\/coverage\/$/m);
    expect(vercelIgnore).not.toMatch(/^\/?data\/$/m);
    expect(vercelIgnore).not.toMatch(/^\/?public\/$/m);
  });
});
