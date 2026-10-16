// DEFECT (UX sprint, 15 Oct 2026, production, 390x844 dark): below the Pub Pal
// onboarding's Continue bar the page changed colour. The Pal surface was the
// main box's background, so it stopped where the box stopped and the body's
// own gradient showed under it, and the bar drew a fill band of its own across
// the page.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const palCss = readFileSync(join(__dirname, "..", "app/pal/pal.css"), "utf8");

function ruleBody(selector: string): string {
  const start = palCss.indexOf(`${selector} {`);
  expect(start, selector).toBeGreaterThan(-1);
  return palCss.slice(start, palCss.indexOf("}", start));
}

describe("the Pub Pal page surface", () => {
  it("is painted by the body, so it runs the full page height", () => {
    const body = ruleBody("body:has(.palExperience)");
    expect(body).toContain("background:");
    expect(body).toContain("var(--paper)");
  });

  it("is not painted by the main box, whose edge was the seam", () => {
    expect(ruleBody(".palExperience")).not.toMatch(/\bbackground\s*:/);
  });

  it("gives the in-flow Continue bar no fill band of its own", () => {
    const phone = palCss.slice(palCss.indexOf("@media (max-width: 760px)"));
    const bar = phone.slice(phone.indexOf(".palOnboardingActions {"));
    const rule = bar.slice(0, bar.indexOf("}"));
    expect(rule).toContain("position: relative;");
    expect(rule).not.toMatch(/\bbackground\s*:/);
    expect(palCss).not.toMatch(/\.palOnboardingActions\s*\{[^}]*background\s*:/);
  });
});
