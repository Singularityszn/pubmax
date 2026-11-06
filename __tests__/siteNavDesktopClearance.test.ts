import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const css = readFileSync(join(process.cwd(), "components/nav/siteNav.css"), "utf8");

describe("desktop map clearance before the header is measured", () => {
  // Server HTML paints before the client publishes the measured header height.
  // A fixed pixel fallback reserves a one-row header even when enlarged text
  // has wrapped it, so the map controls paint under the header, then jump.
  it("scales its fallback with the reader's text size", () => {
    const rule = css.match(/@media \(min-width: 901px\) \{\s*\.appShell:has\(\.siteNavBarFloating\) \{[\s\S]*?\}\s*\}/)?.[0];
    expect(rule).toBeDefined();
    expect(rule).toMatch(/var\(--site-nav-floating-height,\s*4rem\)/);
    expect(rule).not.toMatch(/var\(--site-nav-floating-height,\s*\d+px\)/);
  });
});
