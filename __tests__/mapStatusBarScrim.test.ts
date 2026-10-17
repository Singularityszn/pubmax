import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// THE STATUS BAR IS NOT MAP (#1543). The phone map's canvas runs under the iOS
// status bar by design, and MapLibre places a pin's price label anywhere in its
// viewport, so a price sat under the wifi and battery glyphs. The phone chrome
// fills exactly the safe-area band with the page. A browser cannot render the
// native inset, so this fence holds the rule's geometry in the stylesheet.

const css = readFileSync(join(process.cwd(), "components/mobile/mobileMapShell.css"), "utf8");

function phoneRule(selector: string): string {
  const phone = css.indexOf("@media (max-width: 640px)");
  expect(phone, "the phone block must exist").toBeGreaterThan(-1);
  const start = css.indexOf(`${selector} {`, phone);
  expect(start, `${selector} must be styled inside the phone block`).toBeGreaterThan(-1);
  return css.slice(start, css.indexOf("\n  }", start));
}

describe("phone map status-bar band", () => {
  const scrim = phoneRule(".mobileMapChrome::before");

  it("is exactly the safe-area band, measured from the viewport top", () => {
    expect(scrim).toMatch(/position:\s*absolute;/);
    // The chrome is fixed at --mobile-map-top, so the band climbs that far back.
    expect(scrim).toMatch(/top:\s*calc\(-1 \* var\(--mobile-map-top\)\);/);
    // Zero inset (an ordinary browser) paints nothing.
    expect(scrim).toMatch(/height:\s*env\(safe-area-inset-top, 0px\);/);
  });

  it("spans the full width behind the chrome's side gutters", () => {
    expect(scrim).toMatch(/left:\s*calc\(-1 \* var\(--mobile-map-stack-left\)\);/);
    expect(scrim).toMatch(/right:\s*calc\(-1 \* var\(--mobile-map-stack-right\)\);/);
  });

  it("is painted with the page and never takes a tap", () => {
    expect(scrim).toMatch(/background:\s*color-mix\(in srgb, var\(--paper\)/);
    expect(scrim).toMatch(/pointer-events:\s*none;/);
  });

  it("rides the chrome that both phone map variants mount", () => {
    const chrome = phoneRule(".mobileMapChrome");
    expect(chrome).toMatch(/position:\s*fixed;/);
    const shell = readFileSync(join(process.cwd(), "components/mobile/MobileMapShell.tsx"), "utf8");
    expect(shell.match(/className="mobileMapChrome"/g)?.length).toBe(2);
  });
});
