import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  CLUSTER_CASING_PX,
  CLUSTER_RING_PX,
} from "@/components/map/canvas/buildScene";
import { pricePillTokens } from "@/components/map/canvas/tokens";
import { buildPalette, mixHex } from "@/lib/mapBasemapTaste";
import { defined } from "@/__tests__/helpers/defined";

// What a cluster disc and a price pill have to stand on, per theme, read from the
// SHIPPED stylesheets (the reason mapPinBandContrast.test.ts does the same: a
// restated palette cannot catch a token whose value contradicts its comment).
//
// A disc is paper with an ink casing and a band ring, so three questions:
//   1. does its EDGE separate from every basemap tone it can sit on (3:1)?
//   2. does its FIGURE read on the paper (4.5:1)?
//   3. how far does each band ring stand off the paper? This one is recorded,
//      not gated, because the ring is a hint and the figure beside it carries
//      the claim: amber on paper is under 3:1 in light, which is why the casing
//      exists and why no band is ever the only thing saying what a price is.
const themeCss = readFileSync(join(process.cwd(), "app/theme.css"), "utf8");
const globalsCss = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");

function block(css: string, opener: string): string {
  const start = css.indexOf(opener);
  expect(start, opener).toBeGreaterThan(-1);
  return css.slice(start, css.indexOf("\n}", start));
}
function hexIn(css: string, opener: string, name: string): string {
  const match = new RegExp(`${name}:\\s*(#[0-9a-f]{6})`, "i").exec(block(css, opener));
  expect(match, `${name} in ${opener}`).toBeTruthy();
  return defined(match![1]).toLowerCase();
}
const dark = (name: string) => hexIn(themeCss, 'html[data-theme="dark"] {', name);
const light = (name: string) => hexIn(globalsCss, ":root {", name);

const LIGHT = {
  paper: light("--paper"),
  panelRaised: light("--panel-raised"),
  ink: light("--ink"),
  inkDeep: light("--ink-deep"),
  pint: light("--pint"),
  amber: light("--amber"),
  brick: light("--brick"),
  river: light("--river"),
  parkTint: light("--map-park-tint"),
};
const DARK = {
  panelRaised: dark("--panel-raised"),
  ink: dark("--ink"),
  inkDeep: dark("--ink-deep"),
  pint: dark("--pint"),
  amber: dark("--amber"),
  brick: dark("--brick"),
};

function channels(hex: string): [number, number, number] {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * defined(r) + 0.7152 * defined(g) + 0.0722 * defined(b);
}
/** WCAG 2 contrast ratio between two opaque hex colours. */
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (defined(hi) + 0.05) / (defined(lo) + 0.05);
}
/** `rgba(r, g, b, a)` or `#rrggbb` composited over an opaque hex backdrop. */
function over(colour: string, backdrop: string): string {
  const rgba = /^rgba\((\d+), (\d+), (\d+), ([\d.]+)\)$/.exec(colour);
  if (!rgba) return colour.toLowerCase();
  const alpha = Number(rgba[4]);
  const fg = [Number(rgba[1]), Number(rgba[2]), Number(rgba[3])];
  const bg = channels(backdrop);
  const mixed = fg.map((c, i) => Math.round(c * alpha + defined(bg[i]) * (1 - alpha)));
  return `#${mixed.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

const placeholder = "#000000";
const tasteTokens = (values: Record<string, string>) => ({
  paper: placeholder,
  panelRaised: placeholder,
  ink: placeholder,
  inkDeep: placeholder,
  line: placeholder,
  muted: placeholder,
  pint: placeholder,
  amber: placeholder,
  brass: placeholder,
  river: placeholder,
  riverBright: placeholder,
  buildingEmissive: placeholder,
  parkTint: placeholder,
  ...values,
});

const darkPalette = buildPalette(tasteTokens({}), true);
const lightPalette = buildPalette(
  tasteTokens({
    paper: LIGHT.paper,
    panelRaised: LIGHT.panelRaised,
    pint: LIGHT.pint,
    amber: LIGHT.amber,
    river: LIGHT.river,
    riverBright: LIGHT.river,
    parkTint: LIGHT.parkTint,
    buildingEmissive: LIGHT.amber,
  }),
  false,
);

function tones(palette: ReturnType<typeof buildPalette>, land: string): Record<string, string> {
  return Object.fromEntries(
    Object.entries({
      land: palette.land,
      "land (soft)": palette.landSoft,
      residential: palette.residential,
      park: palette.park,
      building: palette.building,
      water: palette.water,
      "road (minor)": palette.roadMinor,
      "road (secondary)": palette.road,
      "road (major)": palette.roadMajor,
    }).map(([name, colour]) => [name, over(colour, land)]),
  );
}
const DARK_TONES = tones(darkPalette, darkPalette.land);
const LIGHT_TONES = tones(lightPalette, mixHex(LIGHT.paper, "#f4efe6", 0.35));

const EDGE_MIN = 3;
const TEXT_MIN = 4.5;

describe.each([
  {
    theme: "light",
    casing: LIGHT.inkDeep,
    disc: LIGHT.panelRaised,
    figure: LIGHT.inkDeep,
    bands: [LIGHT.pint, LIGHT.amber, LIGHT.brick],
    backgrounds: LIGHT_TONES,
  },
  {
    theme: "dark",
    casing: DARK.ink,
    disc: DARK.panelRaised,
    figure: DARK.ink,
    bands: [DARK.pint, DARK.amber, DARK.brick],
    backgrounds: DARK_TONES,
  },
])("cluster disc over the $theme basemap", ({ casing, disc, figure, bands, backgrounds }) => {
  it("keeps a casing and a ring wide enough to be seen", () => {
    expect(CLUSTER_CASING_PX).toBeGreaterThanOrEqual(1);
    expect(CLUSTER_RING_PX).toBeGreaterThanOrEqual(3);
  });

  it("edges against every basemap tone at 3:1, by its casing or by its paper", () => {
    // The casing and the paper are opposite in luminance, so on any ground the
    // edge is whichever of the two separates from it - the rule the pins' rim
    // and casing already follow (mapPinBandContrast.test.ts).
    const failures: string[] = [];
    for (const [name, background] of Object.entries(backgrounds)) {
      const best = Math.max(contrast(casing, background), contrast(disc, background));
      if (best < EDGE_MIN) failures.push(`${name} ${background}: ${best.toFixed(2)}:1`);
    }
    expect(failures).toEqual([]);
  });

  it("reads its figure on the paper at text contrast", () => {
    expect(contrast(figure, disc)).toBeGreaterThanOrEqual(TEXT_MIN);
  });

  it("keeps all three band rings distinct from one another and from the casing", () => {
    // Recorded, not gated at 3:1: see the header. What is held is that the
    // ring is never lost against either neighbour outright.
    for (const band of bands) {
      expect(contrast(band, disc), `ring ${band} on paper`).toBeGreaterThan(1.5);
      expect(band).not.toBe(casing);
    }
    expect(new Set(bands).size).toBe(3);
  });
});

describe("price pill", () => {
  const inks = {
    light: { ink: LIGHT.ink, surface: "#f6ecd4", tones: LIGHT_TONES },
    dark: { ink: DARK.ink, surface: DARK.panelRaised, tones: DARK_TONES },
  } as const;

  it("publishes the plaque surface and an ink hairline per theme, and no new colour", () => {
    for (const theme of Object.values(inks)) {
      const tokens = pricePillTokens({ ink: theme.ink, pricePlaqueSurface: theme.surface });
      expect(tokens.pillSurface).toBe(theme.surface);
      // The hairline is the theme's own ink, at an alpha, never a band colour.
      const [r, g, b] = channels(theme.ink);
      expect(tokens.pillRim).toMatch(
        new RegExp(`^rgba\\(${r}, ${g}, ${b}, 0\\.\\d+\\)$`),
      );
    }
  });

  it("edges against every basemap tone at 3:1 through its hairline", () => {
    for (const [name, theme] of Object.entries(inks)) {
      const rim = pricePillTokens({ ink: theme.ink, pricePlaqueSurface: theme.surface }).pillRim!;
      const failures: string[] = [];
      for (const [tone, background] of Object.entries(theme.tones)) {
        // The hairline is drawn over the pill's own body at the pill's edge, so
        // it separates the body from the ground by the composite of the two.
        const hairline = over(rim, theme.surface);
        const best = Math.max(
          contrast(hairline, background),
          contrast(theme.surface, background),
        );
        if (best < EDGE_MIN) failures.push(`${tone} ${background}: ${best.toFixed(2)}:1`);
      }
      expect(failures, name).toEqual([]);
    }
  });
});
