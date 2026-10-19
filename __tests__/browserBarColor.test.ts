// THE BROWSER BAR MATCHES THE PAGE  (docs/DESIGN_SYSTEM.md · "Day/night coherence")
//
// <meta name="theme-color"> paints the browser bar (and the PWA title bar) above
// the page. Captain decision, 18 Oct 2026: it matches the page under it, the
// light page floor by day and the dark one by night. It used to paint
// near-black in both themes, so a light page sat under a black strip. This
// holds the one constant to the page tokens it copies, the root layout to the
// constant, and the manifest to the light value.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { BROWSER_BAR_COLOR, BROWSER_BAR_THEME_COLORS } from "@/lib/browserBarColor";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

function ruleBody(css: string, selector: string): string {
  const start = css.indexOf(`${selector} {`);
  expect(start, `${selector} rule exists`).toBeGreaterThan(-1);
  return css.slice(start, css.indexOf("}", start));
}

function tokenIn(body: string, token: string): string {
  const match = new RegExp(`${token}:\\s*(#[0-9a-fA-F]{6})\\b`).exec(body);
  expect(match, `${token} is declared as a hex`).not.toBeNull();
  return (match?.[1] ?? "").toLowerCase();
}

describe("browser bar colour", () => {
  it("copies the light page floor the DOM paints", () => {
    const light = tokenIn(ruleBody(read("app/globals.css"), 'html:not([data-theme="dark"]) body'), "--paper");
    expect(BROWSER_BAR_COLOR.light).toBe(light);
  });

  it("copies the dark page floor", () => {
    const dark = tokenIn(ruleBody(read("app/theme.css"), 'html[data-theme="dark"]'), "--paper");
    expect(BROWSER_BAR_COLOR.dark).toBe(dark);
  });

  it("is two media-scoped entries, light then dark", () => {
    expect(BROWSER_BAR_THEME_COLORS).toEqual([
      { media: "(prefers-color-scheme: light)", color: BROWSER_BAR_COLOR.light },
      { media: "(prefers-color-scheme: dark)", color: BROWSER_BAR_COLOR.dark },
    ]);
  });

  it("is what the root layout's viewport exports, with no colour of its own", () => {
    const layout = read("app/layout.tsx");
    const start = layout.indexOf("export const viewport: Viewport = {");
    expect(start).toBeGreaterThan(-1);
    const block = layout.slice(start, layout.indexOf("};", start));
    expect(block).toContain("themeColor: BROWSER_BAR_THEME_COLORS,");
    expect(block).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(layout).toContain('import { BROWSER_BAR_THEME_COLORS } from "@/lib/browserBarColor";');
  });

  it("is the light value in the web app manifest", () => {
    const manifest = JSON.parse(read("public/manifest.webmanifest")) as {
      theme_color: string;
      background_color: string;
    };
    expect(manifest.theme_color.toLowerCase()).toBe(BROWSER_BAR_COLOR.light);
    expect(manifest.background_color.toLowerCase()).toBe(BROWSER_BAR_COLOR.light);
  });
});
