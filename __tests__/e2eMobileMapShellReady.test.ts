import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

// The phone map shell is held until the map's loading frame lets go, so a spec
// that touches its chrome before then races the product's own timers. Two specs
// flaked on exactly that in PR #2104, each with its own wait. The browser suite
// now has ONE home for the wait, e2e/helpers/mobileMapShell.ts, and this fence
// keeps it the only one.
const ROOT = path.resolve(__dirname, "..");
const E2E = path.join(ROOT, "e2e");
const HELPER = "helpers/mobileMapShell.ts";

// Back and history specs, left in their own lane while that work is open.
// Each still waits at least the shell's ceiling on its own.
const DIRECT_WAIT_ALLOWED = new Set([
  "surface-back-and-home.spec.ts",
  "map-surface-history.spec.ts",
]);

function e2eSources(): Array<{ file: string; text: string }> {
  const out: Array<{ file: string; text: string }> = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "fixtures") walk(full);
      } else if (entry.name.endsWith(".ts")) {
        out.push({ file: path.relative(E2E, full), text: readFileSync(full, "utf8") });
      }
    }
  };
  walk(E2E);
  return out;
}

const TOPBAR = /["'`]\.mobileMapTopbar["'`]/;

/**
 * Whether a source waits for the phone top bar to be visible by itself, in
 * any of the shapes the suite has used: the locator inline, picked by a
 * ternary, or stored in a variable first. Reading the bar for layout or
 * tapping a control on it after the wait is not a wait, and is not flagged.
 */
function waitsOnTopbar(text: string): boolean {
  for (const match of text.matchAll(/expect\(([^;]*?)\)\s*\.toBeVisible/g)) {
    if (TOPBAR.test(match[1] ?? "")) return true;
  }
  for (const match of text.matchAll(
    /(?:const|let)\s+(\w+)\s*=\s*page\s*\.locator\(\s*["'`]\.mobileMapTopbar["'`]\s*\)\s*;/g,
  )) {
    const name = match[1];
    // A variable's reach ends where the same name is declared again: another
    // test reusing `topbar` for a different locator is a different bar.
    const from = (match.index ?? 0) + match[0].length;
    const redeclared = text
      .slice(from)
      .search(new RegExp(`(?:const|let)\\s+${name}\\s*=`));
    const scope = text.slice(from, redeclared === -1 ? undefined : from + redeclared);
    if (new RegExp(`expect\\(\\s*${name}\\s*\\)\\s*\\.toBeVisible`).test(scope)) return true;
  }
  return false;
}

describe("e2e phone map shell readiness", () => {
  it("floors the wait at the shell's own readiness ceiling", () => {
    const helper = readFileSync(path.join(E2E, HELPER), "utf8");
    expect(helper).toMatch(
      /export const MOBILE_MAP_SHELL_READY_MS =\s*MAP_CANVAS_READINESS_CEILING_MS \+ MOBILE_MAP_SHELL_SLACK_MS;/,
    );
    expect(helper).toMatch(/Math\.max\(timeout, MOBILE_MAP_SHELL_READY_MS\)/);
  });

  it("reads the ceiling in the helper and nowhere else in the suite", () => {
    const readers = e2eSources()
      .filter(({ file, text }) => file !== HELPER && text.includes("MAP_CANVAS_READINESS_CEILING_MS"))
      .map(({ file }) => file);
    expect(readers).toEqual([]);
  });

  it("recognises every shape of a top-bar wait, and nothing else", () => {
    const waits = [
      'await expect(page.locator(".mobileMapTopbar")).toBeVisible({ timeout: 30_000 });',
      'await expect(\n  page.locator(phone ? ".mobileMapTopbar" : ".mapToolbar"),\n).toBeVisible();',
      'const topbar = page.locator(".mobileMapTopbar");\nawait expect(topbar).toBeVisible();',
    ];
    const notWaits = [
      'await page.locator(".mobileMapTopbar").getByRole("button", { name: /^Filters/ }).click();',
      'const bar = page.locator(".mobileMapTopbar");\nconst box = await bar.boundingBox();',
      'await expect(page.locator(".mobileMapTopbarLimited")).toBeVisible();',
      'await expect(page.locator(".mapToolbar")).toBeVisible();',
      'const topbar = page.locator(".mobileMapTopbar");\nawait topbar.click();\n' +
        'const topbar = page.locator(".mobileMapTopbarLimited");\nawait expect(topbar).toBeVisible();',
    ];
    for (const sample of waits) expect(waitsOnTopbar(sample), sample).toBe(true);
    for (const sample of notWaits) expect(waitsOnTopbar(sample), sample).toBe(false);
  });

  it("waits for the phone top bar only through expectMobileMapShellReady", () => {
    const offenders = e2eSources()
      .filter(({ file }) => file !== HELPER && !DIRECT_WAIT_ALLOWED.has(file))
      .filter(({ text }) => waitsOnTopbar(text))
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });

  it("keeps its allowlist honest", () => {
    const sources = new Map(e2eSources().map(({ file, text }) => [file, text]));
    for (const file of DIRECT_WAIT_ALLOWED) {
      expect(sources.has(file), `${file} no longer exists`).toBe(true);
      expect(
        waitsOnTopbar(sources.get(file) ?? ""),
        `${file} no longer waits on the top bar directly; drop it from the allowlist`,
      ).toBe(true);
    }
  });
});
