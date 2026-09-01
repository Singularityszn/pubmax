// The hero's lede belongs to the button it describes.
//
// DEFECT (UI audit, 2026-09-01, production, 390x844): "Choose its form and
// voice in five steps..." floated roughly 200px below the call-to-action
// cluster with nothing tying it to the "Meet your Pub Pal" button it is about,
// and the three secondary links wrapped 2 + 1, leaving "Find my pint" dangling
// alone under the pair.
//
// The cause of the first is one line of CSS: at phone width .lpHeroCopy is
// `display: contents`, so the lede was flattened into the .lpHero grid as a
// sibling of the whole action block and took that grid's 38px gap. It now sits
// inside .lpHeroActions, under the primary, on that block's own 14px gap.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const REPO_ROOT = join(__dirname, "..");
const landingTsx = readFileSync(
  join(REPO_ROOT, "components/landing/LandingPage.tsx"),
  "utf8",
);
const landingCss = readFileSync(
  join(REPO_ROOT, "components/landing/landing.css"),
  "utf8",
);

describe("the lede sits under the call to action it describes", () => {
  it("renders inside the action stack, between the primary and the links", () => {
    const actions = landingTsx.match(
      /const heroActions = \([\s\S]*?\n  \);/,
    )?.[0];
    expect(actions, "hero action block present").toBeTruthy();

    const primaryAt = actions!.indexOf("{heroPrimary}");
    const ledeAt = actions!.indexOf("{heroLede}");
    const secondaryAt = actions!.indexOf("lpHeroSecondaryRow");
    expect(primaryAt).toBeGreaterThan(-1);
    expect(ledeAt).toBeGreaterThan(primaryAt);
    expect(secondaryAt).toBeGreaterThan(ledeAt);
  });

  it("is mounted once, and no longer as a sibling of the whole block", () => {
    expect(landingTsx.match(/\{heroLede\}/g)).toHaveLength(1);
    expect(landingTsx).not.toMatch(/\{heroActions\}\s*\n\s*\{heroLede\}/);
  });

  it("carries no margin of its own, so the stack's gap owns the rhythm", () => {
    expect(landingCss).toMatch(/\.lpHeroLede \{[^}]*margin: 0;/);
  });

  it("drops the phone order rule that only made sense as a flattened sibling", () => {
    const phoneBlock = landingCss.slice(landingCss.indexOf(".lpHeroCopy { display: contents; }"));
    expect(phoneBlock.slice(0, 400)).not.toMatch(/\.lpHeroLede \{ order:/);
    expect(phoneBlock.slice(0, 400)).toMatch(/\.lpHeroActions \{ order: 2; \}/);
  });
});

describe("the three secondary links are peers at phone width", () => {
  it("stacks them one per row rather than wrapping 2 + 1", () => {
    const phoneRule = landingCss.match(
      /@media \(max-width: 640px\) \{\s*\.lpHeroSecondaryRow \{[\s\S]*?\}\s*\}/,
    )?.[0];
    expect(phoneRule, "phone rule for the secondary row present").toBeTruthy();
    expect(phoneRule).toContain("flex-direction: column;");
    expect(phoneRule).toContain("align-items: flex-start;");
  });

  it("leaves the wide-viewport row alone", () => {
    const base = landingCss.match(/\n\.lpHeroSecondaryRow \{[\s\S]*?\}/)?.[0];
    expect(base).toContain("flex-wrap: wrap;");
    expect(base).not.toContain("flex-direction: column;");
  });
});
