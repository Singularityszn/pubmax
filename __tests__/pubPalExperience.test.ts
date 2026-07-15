import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const experience = readFileSync(join(process.cwd(), "components/pal/PalExperience.tsx"), "utf8");
const portrait = readFileSync(join(process.cwd(), "components/pal/PalPortrait.tsx"), "utf8");
const css = readFileSync(join(process.cwd(), "app/pal/pal.css"), "utf8");

describe("Pub Pal first meeting and onboarding", () => {
  it("offers all three Pal forms and an eight-part flow", () => {
    expect(experience).toContain("PAL_ONBOARDING_SPECIES.map");
    expect(experience).toContain("step + 1} of 8");
    expect(experience).toContain("Meet your Pub Pal");
  });

  it("keeps account persistence gated while leaving a character-free route", () => {
    expect(experience).toContain("if (!user) return;");
    expect(experience).toContain("Use PUBMAXX without a Pal");
    expect(experience).toContain("Nothing is saved to an account yet");
  });

  it("exposes appearance, voice, personality, memory and visibility controls", () => {
    for (const label of ["Appearance", "Personality", "Voice", "Allow memory proposals", "Show Pal shortcuts"]) {
      expect(experience).toContain(label);
    }
    expect(experience).toContain("/api/pub-pal");
  });

  it("renders an accessible Pal image and supports motion, transparency and contrast preferences", () => {
    expect(portrait).toContain('role="img"');
    expect(portrait).toContain("aria-label");
    expect(css).toContain("prefers-reduced-motion: reduce");
    expect(css).toContain("prefers-reduced-transparency: reduce");
    expect(css).toContain("prefers-contrast: more");
  });

  it("keeps controls thumb-sized and avoids unstable viewport height", () => {
    expect(css).toContain("min-height: 100dvh");
    expect(css).toMatch(/\.palChoice\s*{[\s\S]*?min-height:\s*4\.75rem/);
    expect(css).not.toContain("100vh");
  });
});
