import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { venuePinEdgeTokens } from "@/components/map/canvas/tokens";
import { BUILDING_EXTRUSION_OPACITY } from "@/components/map/canvas/buildScene";
import { buildPalette, mixHex } from "@/lib/mapBasemapTaste";
import { UNPRICED_PIN_FILL, VENUE_PIN_FILL_TOKEN } from "@/lib/mapIcons";

// The dark theme's own values, read from the SHIPPED stylesheet rather than
// restated here. That is the whole point of this file: the defect it guards
// against was a token whose dark value contradicted the code's comment about it
// (`--paper` is a near-black in dark, so a "light rim on saturated glasses" was
// a black rim on a near-black basemap). A restated copy of the palette could not
// have caught that, and cannot catch the next one.
const themeCss = readFileSync(join(process.cwd(), "app/theme.css"), "utf8");

function darkBlock(): string {
  const start = themeCss.indexOf('html[data-theme="dark"] {');
  expect(start).toBeGreaterThan(-1);
  // Up to the first rule that closes at column 0 — the block is flat.
  const end = themeCss.indexOf("\n}", start);
  return themeCss.slice(start, end);
}

function darkToken(name: string): string {
  const match = new RegExp(`${name}:\\s*(#[0-9a-f]{6})`, "i").exec(darkBlock());
  expect(match, `${name} must be a plain hex in the dark theme block`).toBeTruthy();
  return match![1].toLowerCase();
}

const DARK = {
  ink: darkToken("--ink"),
  inkDeep: darkToken("--ink-deep"),
  paper: darkToken("--paper"),
  pint: darkToken("--pint"),
  amber: darkToken("--amber"),
  brick: darkToken("--brick"),
  parkTint: darkToken("--map-park-tint"),
  buildingEmissive: darkToken("--map-building-emissive"),
};

function channels(hex: string): [number, number, number] {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = channels(hex).map((c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2 contrast ratio between two opaque hex colours. */
function contrast(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// Every opaque tone the dark basemap paints UNDER a pin. The dark palette is
// deliberately bimodal (Wave A made roads the lightest strokes on a near-black
// canvas), which is exactly why one rim tone cannot edge a pin on all of them.
const palette = buildPalette(
  {
    paper: DARK.paper,
    panelRaised: DARK.paper,
    ink: DARK.ink,
    inkDeep: DARK.inkDeep,
    line: DARK.inkDeep,
    muted: DARK.ink,
    pint: DARK.pint,
    amber: DARK.amber,
    brass: DARK.brick,
    river: DARK.inkDeep,
    riverBright: DARK.ink,
    buildingEmissive: DARK.buildingEmissive,
    parkTint: DARK.parkTint,
  },
  true,
);

// A building's roof under the 3-D massing pass: the 2-D footprint fill with
// `buildings-3d` composited over it at its hard opacity ceiling. This is the
// brightest thing a pin routinely stands on that is not a road, i.e. the
// "dark buildings" the bug report named.
const massedBuilding = mixHex(
  palette.building,
  DARK.buildingEmissive,
  BUILDING_EXTRUSION_OPACITY,
);

const BACKGROUNDS: Record<string, string> = {
  ground: palette.land,
  landSoft: palette.landSoft,
  residential: palette.residential,
  park: palette.park,
  building: palette.building,
  "building + 3-D massing": massedBuilding,
  water: palette.water,
  "road (minor)": palette.roadMinor,
  "road (secondary)": palette.road,
  "road (major)": palette.roadMajor,
};

const BAND_FILL: Record<string, string> = {
  "0 (<=GBP5.50)": DARK.pint,
  "1 (<=GBP7.00)": DARK.amber,
  "2 (>GBP7.00)": DARK.brick,
  "3 (unpriced)": UNPRICED_PIN_FILL,
};

/** WCAG SC 1.4.11's bar for a non-text graphical object. */
const EDGE_MIN = 3;

describe("dark-mode pin band contrast", () => {
  const edge = venuePinEdgeTokens({ ink: DARK.ink, inkDeep: DARK.inkDeep }, true);

  it("publishes a rim and a casing in dark, and neither in light", () => {
    expect(edge).toEqual({ pinRim: DARK.ink, pinCasing: DARK.inkDeep });
    // Light mode keeps the per-band rim the glasses have always had, so this
    // change cannot move a single light-theme pixel.
    expect(venuePinEdgeTokens({ ink: DARK.ink, inkDeep: DARK.inkDeep }, false)).toEqual({});
  });

  it("introduces no new colour: the edge reuses the map's label tones", () => {
    // --ink over --ink-deep is exactly the pairing the price tag beside the pin
    // already uses (text-color / text-halo-color in buildScene). Reusing it is
    // what keeps the edge clear of every ring semantic on this map: brass
    // (selection, scraped), river (Pint Drops, provisional badge), the what's-on
    // accents, the band halo, and the base layer's sockets.
    expect([edge.pinRim, edge.pinCasing]).toEqual([DARK.ink, DARK.inkDeep]);
    expect(Object.values(BAND_FILL)).toEqual([
      DARK.pint,
      DARK.amber,
      DARK.brick,
      UNPRICED_PIN_FILL,
    ]);
  });

  it("keeps four bands, in the same order, fed by the same tokens", () => {
    expect(VENUE_PIN_FILL_TOKEN).toEqual(["pint", "amber", "brick", null]);
  });

  it("gives every pin an edge over every dark basemap tone", () => {
    const failures: string[] = [];
    for (const [name, background] of Object.entries(BACKGROUNDS)) {
      // The rim and the casing are opposite luminances, so the pin's edge on any
      // background is whichever of the two separates from it.
      const best = Math.max(
        contrast(edge.pinRim!, background),
        contrast(edge.pinCasing!, background),
      );
      if (best < EDGE_MIN) failures.push(`${name} ${background}: ${best.toFixed(2)}:1`);
    }
    expect(failures).toEqual([]);
  });

  it("documents why one rim tone is not enough (the defect this replaced)", () => {
    // Before the fix the rim was `paper`, which buildScene resolves to
    // `--ink-deep` in dark: a black rim, within 1.1:1 of dark land. And no single
    // tone can do the job either, which is why the fix is a pair and not a
    // brighter tone.
    expect(contrast(DARK.inkDeep, palette.land)).toBeLessThan(1.2);
    for (const tone of [edge.pinRim!, edge.pinCasing!]) {
      const worst = Math.min(
        ...Object.values(BACKGROUNDS).map((bg) => contrast(tone, bg)),
      );
      expect(worst).toBeLessThan(EDGE_MIN);
    }
  });

  it("reports each band's fill contrast against its worst dark background", () => {
    // Not a bar the fill has to clear on its own any more - that is the point of
    // the edge above - but the figures are the record of why it could not: on a
    // 3-D massed building the two lowest-luminance bands sit at ~3.1:1 and
    // ~2.4:1, so a pin whose edge is invisible there is a pin you cannot find.
    const worst = Object.fromEntries(
      Object.entries(BAND_FILL).map(([band, fill]) => [
        band,
        Math.min(...Object.values(BACKGROUNDS).map((bg) => contrast(fill, bg))),
      ]),
    );
    for (const [band, ratio] of Object.entries(worst)) {
      expect(ratio, `${band} fill vs worst background`).toBeGreaterThan(1);
      expect(ratio).toBeLessThan(EDGE_MIN);
    }
    // And on the "dark buildings" the report named, the >GBP7 band really is the
    // weakest of the three priced ones — the diagnosis, kept honest in code.
    expect(contrast(DARK.brick, massedBuilding)).toBeLessThan(
      contrast(DARK.pint, massedBuilding),
    );
    expect(contrast(DARK.brick, massedBuilding)).toBeLessThan(
      contrast(DARK.amber, massedBuilding),
    );
  });
});
