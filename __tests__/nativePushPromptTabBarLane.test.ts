import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The shared bottom card (create-password ask, web push, native push) is fixed
// to bottom: 0 on a z-index BELOW the tab bar (--z-tabbar 1350 over
// --z-overlay-top 1300). On a phone the bar therefore painted over the card's
// buttons. The card has to rest on the bar's top edge wherever a bar is mounted.
const css = readFileSync(
  join(process.cwd(), "components/native/nativePushPrompt.css"),
  "utf8",
);
const globals = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");

function token(name: string): number {
  const match = globals.match(new RegExp(`${name}:\\s*(\\d+)`));
  expect(match, `${name} is declared in app/globals.css`).not.toBeNull();
  return Number(match![1]);
}

describe("nativePushPrompt tab bar lane", () => {
  it("still sits below the tab bar in z order, which is why it must be lifted", () => {
    expect(token("--z-tabbar")).toBeGreaterThan(token("--z-overlay-top"));
  });

  it("lifts the card onto the tab bar's top edge on a phone", () => {
    const phone = css.match(/@media \(max-width: 640px\) \{([\s\S]*?)\n\}\n/);
    expect(phone).not.toBeNull();
    const rule = phone![1].match(
      /body:has\(\.mobileTabBar\) \.nativePushPrompt \{([^}]*)\}/,
    );
    expect(rule).not.toBeNull();
    expect(rule![1]).toContain("var(--tabbar-h");
    expect(rule![1]).toContain("env(safe-area-inset-bottom");
  });

  it("drops back to the screen foot when the bar slides away", () => {
    expect(css).toContain("body:has(.mobileTabBar.isKeyboardHidden) .nativePushPrompt");
  });
});
