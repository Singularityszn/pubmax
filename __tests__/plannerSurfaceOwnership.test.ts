import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Taste gate 2026-08-02, finding M4 - two planners stacked in one sheet.
 *
 * The phone "Plan an outing" sheet and the desktop planner drawer render the same
 * `plannerPanel` tree. The desktop rail (ControlRail: brand block, mode toggle,
 * search box, featured routes, the whole filter stack) had no viewport guard, so
 * the phone sheet held the phone intake form, the built route, AND the entire
 * desktop panel below it. One sheet, two competing planners.
 *
 * One planner per surface. This reads the shipped source, because the defect is
 * a mount that only a phone-width viewport ever shows.
 */

const read = (file: string): string => readFileSync(join(process.cwd(), file), "utf8");

const pubMap = read("components/PubMap.tsx");

function plannerPanelSource(): string {
  const start = pubMap.indexOf("const plannerCrawlPanel = (");
  expect(start, "the planner panel tree").toBeGreaterThan(-1);
  const end = pubMap.indexOf("\n  );", start);
  expect(end, "its closing branch").toBeGreaterThan(start);
  return pubMap.slice(start, end);
}

describe("finding M4 - one planner per surface", () => {
  it("keeps the desktop rail out of the phone sheet", () => {
    const panel = plannerPanelSource();
    // The rail mounts once, and only above the phone breakpoint.
    expect((panel.match(/<ControlRail\b/g) ?? []).length).toBe(1);
    expect(panel, "the rail waits for a desktop viewport").toMatch(
      /\{!mobileViewport \? \(\s*<ControlRail\b/,
    );
  });

  it("leaves the phone its own intake form, mounted once, under the same guard", () => {
    // The form moved out of the panel tree into `phoneDescribeForm` so the
    // panel can seat it at the head or the foot: a crawl the reader is
    // BUILDING leads the phone sheet, and the describe form follows it
    // (verify-preview-4, J04). The guard and the one mount are the invariant.
    expect((pubMap.match(/<MobilePlanActivation\b/g) ?? []).length).toBe(1);
    expect(pubMap, "the phone form waits for a phone, London and an area").toMatch(
      /const phoneDescribeForm =\s*\n?\s*mobileViewport && isLondon && suggestedPlanArea \? \(\s*<MobilePlanActivation\b/,
    );
    // Reordering keyed siblings preserves the generated response when an
    // existing crawl moves the intake from below the route to above it.
    expect(pubMap).toMatch(/<MobilePlanActivation\s+key="describe"/);
    expect(plannerPanelSource()).toContain('<Fragment key="crawl">');
    expect(pubMap).toMatch(
      /builtCrawlLeads \? \[plannerCrawlPanel, phoneDescribeForm\] : \[phoneDescribeForm, plannerCrawlPanel\]/,
    );
  });

  it("still hands the desktop drawer the rail", () => {
    // The desktop drawer renders the same tree, so the guard above is the only
    // thing that decides. If the drawer ever stopped rendering plannerPanel, the
    // rail would have no home at all.
    expect(pubMap).toMatch(/side="left"[\s\S]{0,2000}\{plannerPanel\}/);
  });
});
