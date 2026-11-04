// A small set of named breakpoints (taste plan, 18 Oct 2026, "Desktop").
//
// The stylesheets once cut the screen at about forty different widths: 560,
// 600, 700, 720, 760, 960 and 1100 all meant "phone", "tablet" or "desktop" to
// someone. A layout then changed at a width nobody chose, and two halves of
// one boundary (a max-width here, a min-width there) could overlap or leave a
// gap. Every `@media` width in app/ and components/ is now a member of
// BREAKPOINTS (lib/breakpoints.ts, explained in docs/DESIGN_SYSTEM.md >
// Breakpoints): the narrow side of a boundary reads `max-width: narrowMax`,
// the wide side `min-width: wideMin`.
//
// A width that truly needs its own figure is named below with the reason it
// was measured. The allowlist only shrinks: an entry whose queries are gone
// fails until it is deleted, and an entry may not gain queries.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

import { BREAKPOINTS } from "@/lib/breakpoints";

const ROOT = process.cwd();

function files(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules") continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...files(full));
    else if (name.endsWith(".css")) out.push(full);
  }
  return out;
}

const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");

type WidthFeature = { file: string; feature: string };

/** Every width feature in every `@media` prelude, as `min-width: 641px`. */
function mediaWidths(): WidthFeature[] {
  const out: WidthFeature[] = [];
  for (const full of ["app", "components"].flatMap((d) => files(join(ROOT, d)))) {
    const file = relative(ROOT, full).split("\\").join("/");
    const css = stripComments(readFileSync(full, "utf8"));
    for (const media of css.matchAll(/@media\b([^{;]*)\{/g)) {
      const prelude = media[1] ?? "";
      for (const m of prelude.matchAll(/\b((?:min|max)-width)\s*:\s*([0-9.]+)([a-z%]+)/g)) {
        out.push({ file, feature: `${m[1]}: ${m[2]}${m[3]}` });
      }
      // Range syntax (`width <= 640px`) hides from the check above, so it is
      // refused outright until the set needs it.
      for (const m of prelude.matchAll(/\bwidth\s*[<>]=?\s*[0-9.]+[a-z]*/g)) {
        out.push({ file, feature: m[0] });
      }
    }
  }
  return out;
}

const NAMED = new Set(
  Object.values(BREAKPOINTS).flatMap(({ narrowMax, wideMin }) => [
    `max-width: ${narrowMax}px`,
    `min-width: ${wideMin}px`,
  ]),
);

// Each kept figure, where it lives, how many queries use it, and why.
const ALLOWLIST: ReadonlyArray<{ file: string; feature: string; count: number; reason: string }> = [
  // The map's venue drawer is a full-width bottom sheet to 768px and a side
  // panel from 769px. Measured by e2e/venue-sheet-tablet-command-bar.spec.ts
  // (768 against 820) and the chips' lane beside the drawer.
  { file: "app/globals.css", feature: "max-width: 768px", count: 1, reason: "map venue sheet band" },
  { file: "app/globals.css", feature: "min-width: 769px", count: 1, reason: "map side drawer width, 769 to 1023" },
  { file: "components/map/venueSheet.css", feature: "max-width: 768px", count: 1, reason: "map venue sheet band" },
  { file: "components/map/mapBannerStaging.css", feature: "max-width: 768px", count: 1, reason: "map chips leave beside the sheet" },
  { file: "components/map/mapBannerStaging.css", feature: "min-width: 769px", count: 1, reason: "map chips centre beside the side drawer" },
  // The site nav's narrow-tablet half, 641 to 767: six destinations and the
  // action cluster fit a 573px row only without the Moment dot. From 768 the
  // dot is back. Measured in components/nav/siteNavMoment.css.
  { file: "components/nav/siteNav.css", feature: "max-width: 767px", count: 1, reason: "site nav narrow-tablet row" },
  { file: "components/nav/siteNavMoment.css", feature: "max-width: 767px", count: 1, reason: "site nav narrow-tablet row" },
  { file: "components/landing/landing.css", feature: "max-width: 767px", count: 1, reason: "landing nav mirrors the site nav row" },
  // The landing hero turns into two columns from 960px, the hunt card, the
  // pub card and the rail taking one measure there. The skyline preload that
  // shared this width left with the photograph (1 Nov 2026), and so did the
  // figure's own `max-width: 959px` entry.
  { file: "components/landing/landing.css", feature: "min-width: 960px", count: 2, reason: "landing hero two columns and their shared card measure" },
  { file: "components/landing/landing.css", feature: "max-width: 960px", count: 1, reason: "landing nav link row" },
  // MapLibre's zoom column fits beside the floating home bar only from about
  // 1372px; below that it drops under the toolbar (measured at 768: bar 16-752,
  // zoom-in 713-757). See components/map/mapToolbar.css.
  { file: "components/map/mapToolbar.css", feature: "max-width: 1371px", count: 2, reason: "map zoom column lane" },
];

// The allowlist only shrinks. Lower this when an entry goes; never raise it.
const ALLOWLIST_CEILING = 11;

describe("named breakpoints", () => {
  const widths = mediaWidths();

  it("finds the media queries it guards", () => {
    expect(widths.length).toBeGreaterThan(200);
  });

  it("cuts the screen only at a named breakpoint or an allowlisted figure", () => {
    const allowed = (w: WidthFeature) =>
      NAMED.has(w.feature) || ALLOWLIST.some((a) => a.file === w.file && a.feature === w.feature);
    const strays = widths.filter((w) => !allowed(w)).map((w) => `${w.file} :: ${w.feature}`);
    expect([...new Set(strays)].sort()).toEqual([]);
  });

  it("keeps every allowlist entry in use and no larger than it was", () => {
    for (const entry of ALLOWLIST) {
      const used = widths.filter((w) => w.file === entry.file && w.feature === entry.feature).length;
      expect(used, `${entry.file} :: ${entry.feature} is stale; delete the entry`).toBeGreaterThan(0);
      expect(used, `${entry.file} :: ${entry.feature} gained a query`).toBeLessThanOrEqual(entry.count);
    }
    expect(ALLOWLIST.length).toBeLessThanOrEqual(ALLOWLIST_CEILING);
  });

  it("keeps the named set small and each boundary one line", () => {
    const names = Object.keys(BREAKPOINTS);
    expect(names.length).toBeLessThanOrEqual(5);
    for (const { narrowMax, wideMin } of Object.values(BREAKPOINTS)) expect(wideMin).toBe(narrowMax + 1);
  });
});
