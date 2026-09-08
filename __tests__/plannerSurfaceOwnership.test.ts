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
  const start = pubMap.indexOf("const plannerPanel = planningOpen ? (");
  expect(start, "the planner panel tree").toBeGreaterThan(-1);
  const end = pubMap.indexOf("\n  ) : null;", start);
  expect(end, "its closing branch").toBeGreaterThan(start);
  return pubMap.slice(start, end);
}

describe("finding M4 - one planner per surface", () => {
  it("keeps the desktop rail out of the phone sheet", () => {
    const panel = plannerPanelSource();
    // Discovery selects exactly one form before the panel orders its content.
    expect((pubMap.match(/<ControlRail\b/g) ?? []).length).toBe(1);
    expect(pubMap, "only desktop discovery mounts the rail").toMatch(
      /const plannerDiscovery = mobileViewport \? phoneDescribeForm : \(\s*<ControlRail\b/,
    );
    expect(panel).not.toMatch(/<ControlRail\b/);
  });

  it("leaves the phone its own intake form, mounted once, under the same guard", () => {
    // Phone discovery retains its viewport, city and area guards.
    expect((pubMap.match(/<MobilePlanActivation\b/g) ?? []).length).toBe(1);
    expect(pubMap, "the phone form waits for a phone, London and an area").toMatch(
      /const phoneDescribeForm =\s*\n?\s*mobileViewport && isLondon && suggestedPlanArea \? \(\s*<MobilePlanActivation\b/,
    );
    expect((pubMap.match(/\bphoneDescribeForm\b/g) ?? []).length).toBe(2);
    // Each order contains discovery once and the planned crawl once.
    expect(pubMap).toMatch(
      /\[plannerHead, plannerFoot\] = builtCrawlLeads\s*\? \[plannedCrawl, plannerDiscovery\]\s*: \[plannerDiscovery, plannedCrawl\];/,
    );
    expect((pubMap.match(/\bplannerDiscovery\b/g) ?? []).length).toBe(3);
    const panel = plannerPanelSource();
    expect(panel).not.toMatch(/<MobilePlanActivation\b/);
    expect((panel.match(/\{plannerHead\}/g) ?? []).length).toBe(1);
    expect((panel.match(/\{plannerFoot\}/g) ?? []).length).toBe(1);
  });

  it("still hands the desktop drawer the rail", () => {
    // The desktop drawer renders the same tree, so the guard above is the only
    // thing that decides. If the drawer ever stopped rendering plannerPanel, the
    // rail would have no home at all.
    expect(pubMap).toMatch(/side="left"[\s\S]{0,2000}\{plannerPanel\}/);
  });
});
