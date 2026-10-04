import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { defined } from "@/__tests__/helpers/defined";

const ROOT = process.cwd();
const read = (file: string): string => readFileSync(join(ROOT, file), "utf8");
const AA_SMALL_TEXT = 4.5;

function channels(hex: string): [number, number, number] {
  const value = hex.replace("#", "");
  const parsed = [0, 2, 4].map((index) =>
    Number.parseInt(value.slice(index, index + 2), 16),
  );
  return [defined(parsed[0]), defined(parsed[1]), defined(parsed[2])];
}

function relativeLuminance(hex: string): number {
  const [red, green, blue] = channels(hex).map((channel) => {
    const scaled = channel / 255;
    return scaled <= 0.04045 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * defined(red) + 0.7152 * defined(green) + 0.0722 * defined(blue);
}

function contrastRatio(foreground: string, background: string): number {
  const first = relativeLuminance(foreground);
  const second = relativeLuminance(background);
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
}

function blendOver(foreground: string, underlying: string, alpha: number): string {
  const fg = channels(foreground);
  const bg = channels(underlying);
  return `#${fg.map((value, index) =>
    Math.round(value * alpha + defined(bg[index]) * (1 - alpha))
      .toString(16)
      .padStart(2, "0")
  ).join("")}`;
}

function tokenValue(css: string, token: string): string {
  const match = css.match(
    new RegExp(`^\\s*${token}\\s*:\\s*(#[0-9a-f]{3,8})\\s*;`, "im"),
  );
  expect(match, `${token} is declared with a literal hex`).not.toBeNull();
  return defined((match as RegExpMatchArray)[1]);
}

function ruleBody(css: string, selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escapedSelector}\\s*\\{([\\s\\S]*?)\\}`));
  expect(match, `${selector} rule exists`).not.toBeNull();
  return defined((match as RegExpMatchArray)[1]);
}

describe("map retry notice contrast", () => {
  const globals = read("app/globals.css");
  const theme = read("app/theme.css");

  it("uses semantic ink for the resting notice and inherits it for Retry", () => {
    expect(ruleBody(globals, ".mapSoftRetry")).toMatch(/color:\s*var\(--ink\)\s*;/);
    expect(ruleBody(globals, ".mapSoftRetryBtn")).toMatch(/color:\s*inherit\s*;/);
  });

  it("keeps resting and hover text above AA on the dark toast", () => {
    const darkInk = tokenValue(theme, "--ink");
    const darkSurface = tokenValue(theme, "--ink-deep");
    const brass = tokenValue(theme, "--brass");
    const darkToastOverLightMap = blendOver(darkSurface, "#ffffff", 0.92);
    const lightInk = tokenValue(globals, "--ink");
    const lightPaper = tokenValue(globals, "--paper");
    const lightToastOverDarkMap = blendOver(lightPaper, "#000000", 0.94);

    // The toast is translucent over a live map, so prove the worst simple
    // compositing edges rather than comparing against the solid token alone.
    expect(
      contrastRatio(darkInk, darkToastOverLightMap),
      `${darkInk} on ${darkSurface} is the resting dark-theme ratio`,
    ).toBeGreaterThanOrEqual(AA_SMALL_TEXT);
    expect(
      contrastRatio(darkSurface, brass),
      `${darkSurface} on ${brass} is the Retry hover ratio`,
    ).toBeGreaterThanOrEqual(AA_SMALL_TEXT);
    expect(
      contrastRatio(lightInk, lightToastOverDarkMap),
      `${lightInk} on ${lightToastOverDarkMap} is the worst light-theme composite`,
    ).toBeGreaterThanOrEqual(AA_SMALL_TEXT);
  });

  it("keeps the light-theme override on semantic ink", () => {
    const lightOverride = globals.match(
      /\[data-theme="light"\] \.mapSoftRetry\s*\{([\s\S]*?)\}/,
    );
    expect(lightOverride, "light map retry override exists").not.toBeNull();
    expect(lightOverride?.[1]).toMatch(/color:\s*var\(--ink/);
  });
});
