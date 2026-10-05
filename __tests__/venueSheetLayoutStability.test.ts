import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { SHEET_ENTRANCE_MS } from "@/lib/sheetSnap";

/**
 * THE PHONE VENUE SHEET ARRIVES WITHOUT MOVING THE PAGE.
 *
 * Measured on the audit's own phone rig (390x844, 4x CPU, Slow 4G) against a
 * production build, a `/map?sel=<id>` arrival recorded CLS 0.3141, every point
 * of it attributed to `section.mapDrawer.mobileSharedSheet.right`. A frame-by-
 * frame trace of the sheet's own box said why, and it was two faults with one
 * shape — the sheet is bottom-anchored, so anything that changes its HEIGHT
 * moves every pixel inside it, and Chrome scores that:
 *
 *   6181 ms  top=778  h=2    the sheet mounts and the entrance spring starts
 *   6225 ms  top=607  h=173  mid-spring, hugging a 107px peek summary because
 *                            the venue panel is a separate chunk still in flight
 *   8373 ms  top=316  h=464  the chunk lands, the content triples, the box grows
 *
 * The first travel scored 0.0723 and the second 0.2418. So the entrance is a
 * TRANSFORM now (transform and opacity are the only properties exempt from the
 * score) and the height is set at once, and the wait for the panel's chunk
 * reserves the sheet exactly as the wait for its data always did.
 *
 * Source fences, because neither rule is visible to a browser test that does not
 * throttle: on a fast wire the chunk lands inside the entrance and the sheet
 * never hugs a short body at all. docs/proof/map-bytes-first-pin/ holds the
 * measured before and after.
 */

const ROOT = path.join(__dirname, "..");
const read = (relative: string): string =>
  readFileSync(path.join(ROOT, relative), "utf8");

const shellCss = read("components/mobile/mobileMapShell.css");
const dragHook = read("components/mobile/useSheetHeightDrag.ts");
const pubMap = read("components/PubMap.tsx");

describe("the entrance moves the sheet, never the layout", () => {
  it("slides in on a transform rather than growing a height", () => {
    expect(shellCss).toMatch(
      /@keyframes mobileSheetRise\s*{\s*from\s*{\s*transform:\s*translateY\(100%\);\s*}\s*to\s*{\s*transform:\s*translateY\(0\);\s*}\s*}/,
    );
    expect(shellCss).toMatch(
      /\.mobileSharedSheet\.mapDrawer\.sheet-entering\s*{[^}]*animation:\s*mobileSheetRise/,
    );
  });

  it("spends the one duration lib/sheetSnap.ts owns", () => {
    const rule = shellCss.match(
      /\.mobileSharedSheet\.mapDrawer\.sheet-entering\s*{[^}]*}/,
    )?.[0];
    expect(rule).toBeTruthy();
    expect(rule).toContain(`mobileSheetRise ${SHEET_ENTRANCE_MS}ms`);
  });

  it("stands the animation down under reduced motion", () => {
    expect(shellCss).toMatch(
      /@media \(prefers-reduced-motion: reduce\)\s*{\s*\.mobileSharedSheet\.mapDrawer\.sheet-entering\s*{\s*animation:\s*none;\s*}\s*}/,
    );
  });

  it("lays the box out at its resting snap on the first painted frame", () => {
    const openAtSnap = dragHook.slice(
      dragHook.indexOf("const openAtSnap = useCallback("),
      dragHook.indexOf("useEffect(() => () => {"),
    );
    expect(openAtSnap).toContain("jumpTo(capsForViewport()[snap]);");
    // A height spring here is the defect: it is what moved the sheet 462px.
    expect(openAtSnap).not.toContain("animateTo(");
  });

  it("ends the entrance when a finger takes the sheet", () => {
    // The slide is a transform and a drag is a height; both at once would move
    // the box the reader is holding.
    expect(dragHook).toMatch(
      /setEntering\(false\);[\s\S]{0,220}getBoundingClientRect\(\)\.height/,
    );
  });
});

describe("the loading panel reserves the sheet", () => {
  it("gives the venue panel's chunk a skeleton to wait behind", () => {
    expect(pubMap).toMatch(
      /const VenueInspector = dynamic\(\s*\(\) => import\("@\/components\/map\/VenueInspector"\),\s*\{ ssr: false, loading: \(\) => <VenueSheetSkeleton \/> \},/,
    );
  });

  it("asks for more than the largest snap so the sheet sits at its cap", () => {
    expect(shellCss).toMatch(
      /\.mobileSharedSheet \.venueSheetSkeleton\s*{\s*min-height:\s*92dvh;\s*}/,
    );
  });

  it("draws one skeleton when both waits overlap", () => {
    expect(shellCss).toMatch(
      /\.mobileSharedSheet \.venueSheetSkeleton \+ \.venueSheetSkeleton\s*{\s*display:\s*none;\s*}/,
    );
  });
});
