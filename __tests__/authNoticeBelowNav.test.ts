import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The sign-in notice was fixed at top: 1rem, on top of the floating nav pill, so
// it hid the nav links while it was shown (1440px, expired sign-in link).
describe("authCallbackNotice position", () => {
  const css = readFileSync(join(process.cwd(), "app/auth/auth.css"), "utf8");
  const rule = css.slice(css.indexOf(".authCallbackNotice {"), css.indexOf("}", css.indexOf(".authCallbackNotice {")));

  it("sits below the nav pill", () => {
    expect(rule).toMatch(/top:\s*calc\(max\(1rem, env\(safe-area-inset-top\)\) \+ 4\.75rem\)/);
  });
});
