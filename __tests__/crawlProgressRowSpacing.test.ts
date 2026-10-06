import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// "Walking · 0/3 stops" printed flush against the "Check last train" button
// above it: the progress row only had a bottom margin, and that button has none.
const css = readFileSync(join(process.cwd(), "components/map/routePanel.css"), "utf8");

describe("crawl progress row spacing", () => {
  it("keeps space above the progress line as well as below it", () => {
    const rule = css.match(/\.crawlProgressRow \{([^}]*)\}/);
    expect(rule).not.toBeNull();
    expect(rule![1]).toMatch(/margin:\s*12px 0;/);
  });

  it("prints the progress line in the accent ink, not an undefined token's gold", () => {
    const status = css.match(/\.crawlProgressStatus,\s*\.crawlProgressDone \{([^}]*)\}/);
    expect(status).not.toBeNull();
    expect(status![1]).toContain("color: var(--brass-ink)");
    expect(status![1]).not.toContain("#e0b34a");
  });
});
