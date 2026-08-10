import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "..");

describe("social and skip-link styles use semantic tokens", () => {
  it("does not introduce raw colors or global z-index literals", () => {
    for (const file of ["app/social/social.css", "components/a11y/skipLink.css"]) {
      const source = readFileSync(resolve(root, file), "utf8");

      expect(source).not.toMatch(/z-index:\s*\d+/);
      expect(source).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    }
  });

  it("uses shared tokens for overlay and state colors", () => {
    const social = readFileSync(resolve(root, "app/social/social.css"), "utf8");
    const skipLink = readFileSync(resolve(root, "components/a11y/skipLink.css"), "utf8");

    expect(social).toContain("z-index: var(--z-modal)");
    expect(social).toContain("var(--ink-deep)");
    expect(social).toContain("var(--color-negative)");
    expect(social).toContain("var(--color-on-inverse)");
    expect(skipLink).toContain("z-index: var(--z-overlay-top)");
    expect(skipLink).toContain("var(--panel-overlay)");
    expect(skipLink).toContain("var(--brass)");
  });
});
