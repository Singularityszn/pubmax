import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { OG } from "@/lib/ogBrand";
import { APP_NAME, BRAND_NAME } from "@/lib/brandNaming";
import {
  STORE_LISTING_FIELDS,
  STORE_LISTING_LIMITS,
  storeListingFieldFits,
  type StoreListingField,
} from "@/lib/storeListing";

// Contract for the store visual identity masters (issue #440), re-branded to the
// Wave C icon identity (#520/#523): a clean WHITE tile with the coral
// double-struck X, no text, no ember. Hexes never drift from the OG brand kit;
// geometry never drifts from the canonical 64-grid double-struck X polygons
// (components/brand/PubmaxxMark.tsx MARK_GEOMETRY, the same numbers
// scripts/gen-brand-assets.mjs and scripts/gen-native-app-icons.mjs stamp).
// These are the masters scripts/gen-store-assets.mjs renders the whole store PNG
// set from, so a drift here ships to both stores.

const DIR = join(process.cwd(), "public", "store-assets");
const WHITE = "#ffffff";

// The canonical double-struck X polygons, verbatim from MARK_GEOMETRY: the thick
// descending stroke, the two thin ascending strokes, and the simplified single
// ascending stroke (`slashSimple`) for the small-optics tier.
const X_THICK = "9,10 21,10 55,54 43,54";
const X_THIN_A = "42,10 47,10 13,54 8,54";
const X_THIN_B = "51,10 56,10 22,54 17,54";
const X_SLASH_SIMPLE = "45,10 53,10 19,54 11,54";

// The retired Clink arms — these MUST NOT appear on any master any more.
const RETIRED_CLINK_A = "19.8,8.7 10.2,17.3 46.0,53.7 52.0,48.3";
const RETIRED_CLINK_B = "44.2,8.7 53.8,17.3 18.0,53.7 12.0,48.3";

// Masters that draw the X at all (they all carry the thick descending stroke).
const MARK_CARRIERS = [
  "icon-square.svg",
  "icon-square-small.svg",
  "play-adaptive-foreground.svg",
  "splash.svg",
] as const;

// Masters that draw the full double-struck X (both thin ascending strokes).
// icon-square-small is EXCLUDED — it takes the small-optics single-slash cut.
const DOUBLE_STRUCK_CARRIERS = [
  "icon-square.svg",
  "play-adaptive-foreground.svg",
  "splash.svg",
] as const;

// White-tile masters (the icon field flips from the retired ink to pure white).
// The splash is deliberately EXCLUDED — splashes keep the ink field per #523.
const WHITE_FIELDS = [
  "icon-square.svg",
  "icon-square-small.svg",
  "play-adaptive-background.svg",
] as const;

const ALL_MASTERS = [
  ...new Set([...MARK_CARRIERS, ...WHITE_FIELDS, "play-adaptive-background.svg"]),
] as const;

const read = (name: string) => readFileSync(join(DIR, name), "utf8");

describe("store asset masters", () => {
  it("every master is an svg with no text (owner lock: mark only)", () => {
    for (const name of ALL_MASTERS) {
      const svg = read(name);
      expect(svg, name).toContain('xmlns="http://www.w3.org/2000/svg"');
      expect(svg, name).not.toMatch(/<text[\s>]/);
      expect(svg, name).not.toMatch(/<tspan[\s>]/);
    }
  });

  it("mark carriers draw the coral double-struck X, never the retired Clink arms", () => {
    for (const name of MARK_CARRIERS) {
      const svg = read(name);
      // The thick descending stroke, as a filled polygon in coral.
      expect(svg, name).toContain(`points="${X_THICK}"`);
      expect(svg, name).toContain(`fill="${OG.coral}"`);
      expect(svg, name).toMatch(/<polygon[\s>]/);
      // The retired Clink arms are gone.
      expect(svg, name).not.toContain(RETIRED_CLINK_A);
      expect(svg, name).not.toContain(RETIRED_CLINK_B);
    }
  });

  it("full-size carriers draw both thin ascending strokes (double-struck)", () => {
    for (const name of DOUBLE_STRUCK_CARRIERS) {
      const svg = read(name);
      expect(svg, name).toContain(`points="${X_THIN_A}"`);
      expect(svg, name).toContain(`points="${X_THIN_B}"`);
      // Not the simplified small-optics slash.
      expect(svg, name).not.toContain(X_SLASH_SIMPLE);
    }
  });

  it("small-optics cut: icon-square-small takes the single-slash `slashSimple`", () => {
    const small = read("icon-square-small.svg");
    // The simplified single ascending stroke + the thick descending stroke…
    expect(small).toContain(`points="${X_SLASH_SIMPLE}"`);
    expect(small).toContain(`points="${X_THICK}"`);
    // …not the double-struck thin pair (the channel closes up below ~24px)…
    expect(small).not.toContain(X_THIN_A);
    expect(small).not.toContain(X_THIN_B);
    // …no glow gradient (mud at these sizes).
    expect(small).not.toMatch(/<radialGradient[\s>]/);
  });

  it("no ember anywhere: static store exports drop the lit node (#523)", () => {
    for (const name of ALL_MASTERS) {
      const svg = read(name);
      // No coral-bright fill and no r 3.2 node circle on any master.
      expect(svg, name).not.toContain(OG.coralBright);
      expect(svg, name).not.toContain('r="3.2"');
    }
  });

  it("icon masters sit on a pure white tile", () => {
    for (const name of WHITE_FIELDS) {
      expect(read(name), name).toContain(`fill="${WHITE}"`);
    }
  });

  it("splash keeps the ink-deep field (splashes are not icons, #523)", () => {
    const svg = read("splash.svg");
    expect(svg).toContain(`fill="${OG.inkDeep}"`);
    // …but carries the coral X, not the retired Clink.
    expect(svg).toContain(`points="${X_THICK}"`);
    expect(svg).not.toContain(RETIRED_CLINK_A);
  });

  it("adaptive background stays flat white: no mark, no gradient (parallax layer)", () => {
    const svg = read("play-adaptive-background.svg");
    expect(svg).toContain(`fill="${WHITE}"`);
    expect(svg).not.toMatch(/<polygon[\s>]/);
    expect(svg).not.toMatch(/<path[\s>]/);
    expect(svg).not.toMatch(/<radialGradient[\s>]/);
  });
});

// ---------------------------------------------------------------------------
// The listing itself: the copy and the screenshots the owner uploads beside
// these masters. Both stores enforce hard limits at paste time rather than at
// review, so a field that is one character over is discovered by the owner, on
// the day, in the form.
// ---------------------------------------------------------------------------

const SCREENSHOTS = join(process.cwd(), "public", "store-assets", "screenshots");

/**
 * A PNG's real dimensions, read from the IHDR chunk. A file NAMED for a size
 * proves nothing; these are the pixels each store measures on upload.
 */
function pngSize(path: string): { width: number; height: number } {
  const header = readFileSync(path).subarray(0, 33);
  expect(header.subarray(1, 4).toString("ascii"), path).toBe("PNG");
  return { width: header.readUInt32BE(16), height: header.readUInt32BE(20) };
}

type ShotManifest = {
  width: number;
  height: number;
  shots: Array<{ file: string; route: string; caption: string }>;
};

/** What each store measures on upload, and what the generator renders at. */
const REQUIRED_SIZES = [
  { key: "ios-6.7", width: 1290, height: 2796 },
  { key: "ios-6.5", width: 1242, height: 2688 },
  { key: "play-phone", width: 1080, height: 1920 },
] as const;

/** Google Play takes at least two phone screenshots and at most eight. */
const PLAY_MIN_SHOTS = 2;
const PLAY_MAX_SHOTS = 8;

describe("store listing copy", () => {
  it("fits every field into the form that will accept it", () => {
    // Walking the record rather than listing fields by hand: a field added to
    // lib/storeListing.ts without a limit cannot slip past unchecked.
    for (const field of Object.keys(STORE_LISTING_FIELDS) as StoreListingField[]) {
      const value = STORE_LISTING_FIELDS[field];
      expect(value.length, `${field} is ${value.length} chars`).toBeLessThanOrEqual(
        STORE_LISTING_LIMITS[field],
      );
      expect(storeListingFieldFits(field), field).toBe(true);
      expect(value.trim(), field).not.toBe("");
    }
  });

  it("keeps the limits the two stores actually publish", () => {
    expect(STORE_LISTING_LIMITS.name).toBe(30);
    expect(STORE_LISTING_LIMITS.subtitle).toBe(30);
    expect(STORE_LISTING_LIMITS.shortDescription).toBe(80);
    expect(STORE_LISTING_LIMITS.keywords).toBe(100);
    expect(STORE_LISTING_LIMITS.description).toBe(4000);
  });

  it("names the app on the install surface and the brand in the prose", () => {
    // AGENTS.md: PUBMAXX is the brand, PUBMAXXING is the app. The listing name
    // is what appears under the icon, so it is the app.
    expect(STORE_LISTING_FIELDS.name).toBe(APP_NAME);
    expect(STORE_LISTING_FIELDS.description).toContain(BRAND_NAME);
  });

  it("spends no keyword character on a term the name already earns", () => {
    // Apple indexes the name and subtitle for free, so a repeat buys nothing
    // and the field is only 100 characters wide.
    const keywords = STORE_LISTING_FIELDS.keywords.split(",");
    expect(new Set(keywords).size, "duplicate keyword").toBe(keywords.length);
    for (const keyword of keywords) {
      expect(keyword, "leading or trailing space wastes a character").toBe(keyword.trim());
      expect(
        STORE_LISTING_FIELDS.subtitle.toLowerCase(),
        `subtitle already carries "${keyword}"`,
      ).not.toContain(keyword.toLowerCase());
    }
  });

  it("obeys the house voice: no exclamation marks, no em dashes", () => {
    for (const value of Object.values(STORE_LISTING_FIELDS)) {
      expect(value).not.toContain("!");
      expect(value).not.toContain("—");
    }
  });

  it("says what a price is worth rather than promising one", () => {
    // The whole product is built on not making a price claim it cannot keep,
    // and a listing is the loudest place that claim could be made.
    expect(STORE_LISTING_FIELDS.description).toContain("Treat it as a steer, not a promise.");
  });
});

describe("store screenshots", () => {
  it("ships every size both stores require, at its real pixel size", () => {
    for (const size of REQUIRED_SIZES) {
      const manifest = JSON.parse(
        readFileSync(join(SCREENSHOTS, size.key, "manifest.json"), "utf8"),
      ) as ShotManifest;
      expect(manifest.width, size.key).toBe(size.width);
      expect(manifest.height, size.key).toBe(size.height);

      for (const shot of manifest.shots) {
        // Rendered at the target size, never upscaled from a 430-wide frame.
        expect(pngSize(join(SCREENSHOTS, size.key, shot.file)), shot.file).toEqual({
          width: size.width,
          height: size.height,
        });
      }
    }
  });

  it("stays inside Google Play's count, which is the narrower of the two", () => {
    const manifest = JSON.parse(
      readFileSync(join(SCREENSHOTS, "play-phone", "manifest.json"), "utf8"),
    ) as ShotManifest;
    expect(manifest.shots.length).toBeGreaterThanOrEqual(PLAY_MIN_SHOTS);
    expect(manifest.shots.length).toBeLessThanOrEqual(PLAY_MAX_SHOTS);
  });

  it("shows the same journey in the same order at every size", () => {
    // A listing that leads with the map on one device and the feed on another
    // is two different arguments for the same app.
    const orders = REQUIRED_SIZES.map((size) => {
      const manifest = JSON.parse(
        readFileSync(join(SCREENSHOTS, size.key, "manifest.json"), "utf8"),
      ) as ShotManifest;
      return manifest.shots.map((shot) => `${shot.route}|${shot.caption}`).join(",");
    });
    expect(new Set(orders).size, "the sizes disagree about the shot list").toBe(1);
    // The map is the core promise, so it leads.
    expect(orders[0]?.startsWith("/map|")).toBe(true);
  });

  it("carries a caption per shot, worded for a store field rather than baked in", () => {
    const manifest = JSON.parse(
      readFileSync(join(SCREENSHOTS, "ios-6.7", "manifest.json"), "utf8"),
    ) as ShotManifest;
    for (const shot of manifest.shots) {
      expect(shot.caption.trim(), shot.file).not.toBe("");
      expect(shot.caption, shot.file).not.toContain("!");
      expect(shot.caption, shot.file).not.toContain("—");
    }
  });
});
