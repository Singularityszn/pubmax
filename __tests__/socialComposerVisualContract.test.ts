import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const globalsCss = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");
const themeCss = readFileSync(join(process.cwd(), "app/theme.css"), "utf8");
const socialCss = readFileSync(join(process.cwd(), "app/social/social.css"), "utf8");
const composerSource = readFileSync(
  join(process.cwd(), "app/social/SocialComposer.tsx"),
  "utf8",
);

function block(css: string, selector: string): string {
  const start = css.indexOf(`${selector} {`);
  expect(start, `${selector} must exist`).toBeGreaterThan(-1);
  const end = css.indexOf("\n}", start);
  return css.slice(start, end);
}

function token(source: string, name: string): string {
  const match = new RegExp(`${name}:\\s*(#[0-9a-f]{6})`, "i").exec(source);
  expect(match, `${name} must be a plain hex in this block`).toBeTruthy();
  return match![1].toLowerCase();
}

function channels(hex: string): [number, number, number] {
  const value = parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function mixSrgb(a: string, b: string, percentA: number): string {
  const first = channels(a);
  const second = channels(b);
  const weight = percentA / 100;
  return first
    .map((channel, index) =>
      Math.round(channel * weight + second[index] * (1 - weight)),
    )
    .map((channel) => channel.toString(16).padStart(2, "0"))
    .join("")
    .replace(/^/, "#");
}

function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((channel) => {
    const value = channel / 255;
    return value <= 0.04045
      ? value / 12.92
      : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(first: string, second: string): number {
  const [light, dark] = [luminance(first), luminance(second)].sort(
    (a, b) => b - a,
  );
  return (light + 0.05) / (dark + 0.05);
}

function shippedControlBorderWeight(): number {
  const composer = block(socialCss, ".socialComposer");
  const match =
    /--social-control-border:\s*color-mix\(\s*in srgb,\s*var\(--ink-soft\)\s+(\d+)%,\s*var\(--panel-raised\)\s*\)/.exec(
      composer,
    );
  expect(match, "composer must ship one theme-aware control-border token").toBeTruthy();
  return Number(match![1]);
}

describe("Social composer visual contract", () => {
  it("keeps every unfocused form boundary at 3:1 in both shipped themes", () => {
    const lightRoot = block(globalsCss, ":root");
    const lightBody = block(
      globalsCss,
      'html:not([data-theme="dark"]) body',
    );
    const dark = block(themeCss, 'html[data-theme="dark"]');
    const weight = shippedControlBorderWeight();
    const themes = [
      {
        name: "light",
        borderBase: token(lightRoot, "--ink-soft"),
        panel: token(lightBody, "--panel-raised"),
      },
      {
        name: "dark",
        borderBase: token(dark, "--ink-soft"),
        panel: token(dark, "--panel-raised"),
      },
    ];

    expect(socialCss).toMatch(
      /\.socialComposer textarea,[\s\S]*?border:\s*1px solid var\(--social-control-border\)/,
    );
    for (const theme of themes) {
      const border = mixSrgb(theme.borderBase, theme.panel, weight);
      expect(contrast(border, theme.panel), theme.name).toBeGreaterThanOrEqual(3);
    }
  });

  it("ships one focus ring, a visible body label, mobile-safe spacing, and legible disabled action", () => {
    expect(composerSource).toMatch(
      /<label className="socialPostBody">\s*Post\s*<textarea/,
    );
    expect(socialCss).toMatch(
      /padding:[\s\S]*?calc\(24px \+ env\(safe-area-inset-bottom, 0px\)\)/,
    );
    expect(socialCss).toMatch(
      /@media \(max-width: 640px\)[\s\S]*?\.socialComposer textarea\s*{[^}]*resize:\s*none/,
    );
    expect(socialCss).toMatch(
      /\.socialComposer :is\(textarea, input, select\):focus-visible\s*{[^}]*outline-offset:\s*0/,
    );
    expect(socialCss).toMatch(
      /\.socialComposer header button:disabled\s*{[^}]*opacity:\s*1/,
    );
  });
});
