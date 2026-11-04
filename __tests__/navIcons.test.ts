import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { buildTabs } from "@/components/nav/MobileTabBar";
import { navIcon } from "@/components/nav/navIcons";
import { PRIMARY_NAV_ITEMS } from "@/components/nav/navigationModel";

// One icon per primary door, drawn the same by the phone dock and the desktop
// SiteNav (components/nav/navIcons.ts).

describe("the primary doors' icons", () => {
  it("gives every primary door an icon", () => {
    for (const item of PRIMARY_NAV_ITEMS) expect(navIcon(item.key), item.key).toBeTruthy();
  });

  it("draws the phone dock's doors with the shared icons", () => {
    for (const tab of buildTabs()) expect(tab.Icon).toBe(navIcon(tab.key));
  });

  it("keeps the tablet band's word-only row and its whole words", () => {
    const css = readFileSync(join(process.cwd(), "components/nav/siteNav.css"), "utf8");
    // Icons are drawn from 1024px only; below it the measured row is unchanged.
    expect(css).toMatch(/\.siteNavIcon,\s*\.siteNavGlide \{\s*display: none;/);
    expect(css).toMatch(/@media \(min-width: 1024px\) \{[\s\S]*?\.siteNavIcon \{\s*display: block;/);
    // The clink never plays for a reader who asked for less motion.
    expect(css).toMatch(/@media \(min-width: 1024px\) and \(prefers-reduced-motion: no-preference\) \{[\s\S]*?animation: siteNavClink/);
  });
});
