import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// Hero scroll cinema hard gate (feat(landing): hero scroll cinema with
// aperture splash, PIECE 2): prefers-reduced-motion and phones (<=700px)
// get a static composed hero - no scrub, no motion. Source-lock companion
// to e2e/hero-cinema-reduced-motion.spec.ts, which proves the same gate in
// a real browser.

const heroCinemaCss = readFileSync(
  join(process.cwd(), "components/landing/heroCinema.css"),
  "utf8",
);
const landingTsx = readFileSync(
  join(process.cwd(), "components/landing/LandingPage.tsx"),
  "utf8",
);
const motionVocabulary = readFileSync(
  join(process.cwd(), "lib/motionVocabulary.ts"),
  "utf8",
);

describe("hero scroll cinema reduced-motion and phone gate", () => {
  it("defaults --cinema-progress to the settled card (safe fallback)", () => {
    expect(heroCinemaCss).toMatch(/:root\s*\{[^}]*--cinema-progress:\s*1;/);
  });

  it("only opens the cinema treatment inside the compound wide + motion-allowed query", () => {
    const gate = heroCinemaCss.match(
      /@media \(min-width: 701px\) and \(prefers-reduced-motion: no-preference\)\s*\{([\s\S]*)\}\s*$/,
    );
    expect(gate, "compound media query present").toBeTruthy();
    const gatedBlock = gate?.[1] ?? "";

    // The progress-driven transform, opacity and border-radius rules all
    // live inside the gate - none of them may leak outside it.
    expect(gatedBlock).toMatch(/--cinema-progress:\s*0;/);
    expect(gatedBlock).toMatch(/\.thamesHeroPhoto\s*\{/);
    expect(gatedBlock).toMatch(/border-radius:\s*calc\(32px \* var\(--cinema-progress\)\)/);
    expect(gatedBlock).toMatch(/transform:\s*scale\(calc\(1\.06 - 0\.06 \* var\(--cinema-progress\)\)\)/);

    // Nothing outside the gate references --cinema-progress in a rule body
    // (only the safe :root default at the top of the file may).
    const outsideGate = heroCinemaCss.replace(gate?.[0] ?? "", "");
    expect(outsideGate).not.toMatch(/border-radius:\s*calc\(32px \* var\(--cinema-progress\)\)/);
  });

  it("JS scroll listener eligibility mirrors the CSS media query exactly", () => {
    expect(landingTsx).toMatch(/window\.matchMedia\("\(min-width: 701px\)"\)/);
    expect(landingTsx).toMatch(
      /const eligible = wideQuery\.matches && !prefersReducedMotion\(\);/,
    );
    // Ineligible viewports/preferences must fully detach: no lingering
    // scroll listener and no stale --cinema-progress override.
    expect(landingTsx).toMatch(/window\.removeEventListener\("scroll", onScroll\);/);
    expect(landingTsx).toMatch(/hero\.style\.removeProperty\("--cinema-progress"\);/);
  });

  it("reduced motion is read centrally from lib/motionVocabulary, never ad hoc on the landing surface", () => {
    expect(landingTsx).toMatch(
      /import \{ onReducedMotionChange, prefersReducedMotion \} from "@\/lib\/motionVocabulary";/,
    );
    expect(landingTsx).not.toMatch(/matchMedia\("\(prefers-reduced-motion/);
    expect(motionVocabulary).toMatch(/prefers-reduced-motion: reduce/);
  });
});
