import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { MOBILE_MAX_WIDTH } from "@/lib/breakpoints";

// The phone map shell is held until the map's loading frame lets go, so a spec
// that touches its chrome before then races the product's own timers. Two specs
// flaked on exactly that in PR #2104, each with its own wait. The browser suite
// now has ONE home for the wait, e2e/helpers/mobileMapShell.ts, and this fence
// keeps it the only one.
const ROOT = path.resolve(__dirname, "..");
const E2E = path.join(ROOT, "e2e");
const HELPER = "helpers/mobileMapShell.ts";

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

// The controls only the phone shell owns, found by the class the shell gives
// them. Search, Filters, TfL and Near me share their names with the desktop
// toolbar and with sheets, so a bare `page.getByRole` by those names is not
// flagged; More map controls exists only in the shell, so its name is.
const SHELL_CONTROL_CLASS = /locator\(\s*["'`][^"'`]*\.(?:mobileMapFiltersButton|mobileMapTflButton|mobileMapLocateFab)\b/;
const MORE_BY_NAME = /name:\s*["'`]More map controls["'`]/;
const TOPBAR_NAMED_BUTTON =
  /\.getByRole\(\s*["'`]button["'`]\s*,\s*\{\s*name:\s*(?:["'`]Search the map["'`]|\/\^Filters)/;

/**
 * Whether a source reaches one of the phone shell's own controls itself
 * rather than through `mobileMapShellControl`: More map controls by name
 * anywhere, a control by the class the shell gives it, or Search or Filters
 * read off the top bar, inline or from a stored top-bar locator.
 */
function reachesShellControl(text: string): boolean {
  if (MORE_BY_NAME.test(text) || SHELL_CONTROL_CLASS.test(text)) return true;
  const inline = new RegExp(`["'\`]\\.mobileMapTopbar["'\`]\\s*\\)\\s*${TOPBAR_NAMED_BUTTON.source}`);
  if (inline.test(text)) return true;
  for (const match of text.matchAll(
    /(?:const|let)\s+(\w+)\s*=\s*page\s*\.locator\(\s*["'`]\.mobileMapTopbar["'`]\s*\)\s*;/g,
  )) {
    const name = match[1];
    const from = (match.index ?? 0) + match[0].length;
    const redeclared = text
      .slice(from)
      .search(new RegExp(`(?:const|let)\\s+${name}\\s*=`));
    const scope = text.slice(from, redeclared === -1 ? undefined : from + redeclared);
    if (new RegExp(`\\b${name}\\s*${TOPBAR_NAMED_BUTTON.source}`).test(scope)) return true;
  }
  return false;
}

// Search, Filters, Near me and TfL by bare name: the desktop toolbar has
// namesakes, so the lookup is the shell's only in a spec that opens the map
// and sets no viewport wider than a phone.
const BARE_SHARED_NAME =
  /page\s*\.getByRole\(\s*["'`]button["'`]\s*,\s*\{\s*name:\s*(?:["'`]Search the map["'`]|\/\^?Filters|["'`]Near me["'`]|\/TfL)/;

function phoneOnlyMapSpec(text: string): boolean {
  const widths = [...text.matchAll(/width:\s*(\d{3,4})\b/g)].map((m) => Number(m[1]));
  return (
    /["'`]\/map\b/.test(text) &&
    /setViewportSize|viewport:/.test(text) &&
    widths.length > 0 &&
    widths.every((width) => width <= MOBILE_MAX_WIDTH)
  );
}

/**
 * Open PRs that own a phone spec still finding a shell control by bare name.
 * Each entry names its PR and leaves when that PR lands: #2094 owns the food
 * view in map-experience-lens and rewrites the spec around it.
 */
const BARE_NAME_PENDING = new Set(["map-experience-lens.spec.ts"]);

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
      .filter(({ file }) => file !== HELPER)
      .filter(({ text }) => waitsOnTopbar(text))
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });

  it("recognises every way of reaching a shell control, and nothing else", () => {
    const reaches = [
      'await page.getByRole("button", { name: "More map controls" }).click();',
      'await openSheet(page, { name: "More map controls" });',
      'const tfl = page.locator(".mobileMapTflButton .mobileMapCornerBadge");',
      'await page.locator(".mobileMapUtilityCorner .mobileMapLocateFab").click();',
      'const f = page.locator(".mobileMapFiltersButton");',
      'await page\n  .locator(".mobileMapTopbar")\n  .getByRole("button", { name: /^Filters/ })\n  .click();',
      'const topbar = page.locator(".mobileMapTopbar");\nawait topbar.getByRole("button", { name: "Search the map" }).click();',
    ];
    const notReaches = [
      'await page.getByRole("button", { name: /^Filters/ }).click();',
      'await page.getByRole("button", { name: "Search the map" }).click();',
      'await page.getByRole("button", { name: "Near me" }).click();',
      'const rect = document.querySelector(".mobileMapLocateFab");',
      'await expectTouchTargets(page.locator(".mobileMapTopbar button, .mobileMapUtilityCorner button"));',
      'const topbar = page.locator(".mobileMapTopbar");\nawait topbar.getByRole("button", { name: /Choose city/ }).click();',
      'const topbar = page.locator(".mobileMapTopbar");\nawait topbar.click();\n' +
        'const topbar = page.locator(".mapToolbar");\nawait topbar.getByRole("button", { name: /^Filters/ }).click();',
    ];
    for (const sample of reaches) expect(reachesShellControl(sample), sample).toBe(true);
    for (const sample of notReaches) expect(reachesShellControl(sample), sample).toBe(false);
  });

  it("tells a phone map spec's bare shared-name lookup from a desktop or non-map one", () => {
    const lookup = 'await page.getByRole("button", { name: "Search the map" }).click();';
    const phone = `await page.setViewportSize({ width: 390, height: 844 });\nawait page.goto("/map");\n${lookup}`;
    expect(phoneOnlyMapSpec(phone) && BARE_SHARED_NAME.test(phone)).toBe(true);
    const mixed = `${phone}\nawait page.setViewportSize({ width: 1440, height: 900 });`;
    expect(phoneOnlyMapSpec(mixed)).toBe(false);
    const notMap = 'await page.setViewportSize({ width: 390, height: 844 });\nawait page.goto("/drink-wall");\n' +
      'await expect(page.getByRole("button", { name: "Near me" })).toBeVisible();';
    expect(phoneOnlyMapSpec(notMap)).toBe(false);
    expect(BARE_SHARED_NAME.test('page.getByRole("button", { name: "Near me?" })')).toBe(false);
    expect(BARE_SHARED_NAME.test('sheet.getByRole("button", { name: "Near me" })')).toBe(false);
  });

  it("finds no phone map spec reaching a shell control by bare name", () => {
    const offenders = e2eSources()
      .filter(({ file }) => file !== HELPER && !BARE_NAME_PENDING.has(file))
      .filter(({ text }) => phoneOnlyMapSpec(text) && BARE_SHARED_NAME.test(text))
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });

  it("keeps its pending list honest: each entry still offends", () => {
    for (const file of BARE_NAME_PENDING) {
      const text = readFileSync(path.join(E2E, file), "utf8");
      expect(phoneOnlyMapSpec(text) && BARE_SHARED_NAME.test(text), file).toBe(true);
    }
  });

  it("reaches the phone shell's own controls only through mobileMapShellControl", () => {
    const offenders = e2eSources()
      .filter(({ file }) => file !== HELPER)
      .filter(({ text }) => reachesShellControl(text))
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });
});
