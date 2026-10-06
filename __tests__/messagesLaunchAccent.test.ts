import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Signed-in QA F25: the sent bubble was violet and the desktop panel had square
// corners, both off the launch system.
describe("messages surface tokens", () => {
  const css = readFileSync(join(process.cwd(), "app/messages/messages.css"), "utf8");

  it("takes the launch accent, not grape", () => {
    expect(css).not.toContain("--grape");
    expect(css).toMatch(/--messages-accent:\s*var\(--brass\)/);
  });

  it("puts accent ink on the sent bubble", () => {
    const rule = css.slice(css.indexOf(".messageBubbleMine {"), css.indexOf("}", css.indexOf(".messageBubbleMine {")));
    expect(rule).toContain("var(--color-on-accent");
  });

  it("rounds the desktop panel", () => {
    const start = css.indexOf(".messagesSplit {", css.indexOf("min-width: 1024px"));
    const rule = css.slice(start, css.indexOf("}", start));
    expect(rule).toContain("border-radius: var(--radius-lg");
  });
});
