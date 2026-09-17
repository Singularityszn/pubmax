// A REGISTERED NAME NOTHING SENDS IS A TILE THAT READS ZERO FOR EVER.
//
// `docs/analytics/TRACKING_PLAN.md` used to carry a section 6 listing 18 such
// names: `cmdk_open`, `drop_logged`, the five London Capture district names,
// the three open-plan names, both `claim_*` steps, and the rest. Every one was
// in the registry and sent by nothing in `app`, `components` or `lib`. The
// defence for keeping them was that the sanitizer must know an event's shape
// before its first event arrives, which is a promise about a surface that is
// COMING; for a surface that was cancelled, never built, or lost its emitter,
// the row is a zero a reader cannot tell from a real one.
//
// They are deleted, and this is what stops the list growing back: a name and
// its emitter land in the same commit, which is the rule the six loop moments
// already followed through `__tests__/loopMomentEvents.test.ts`.
//
// WHAT THIS PROVES, AND WHAT IT DOES NOT. It proves every registered name is
// NAMED inside a file that also reaches an emitter seam, which is the cheap
// half. It does not prove the call site really fires, or fires once: that is
// each event's own test's job (`useVenueSheetOpened`, the loop-moment latch,
// the verified completion receipt). The weak half is still the one that was
// missing, because all 18 failed at this bar and nobody noticed for months.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ANALYTICS_EVENTS } from "@/lib/analyticsEvents";

const ROOT = join(__dirname, "..");
const SOURCE_ROOTS = ["app", "components", "lib"];
const REGISTRY = join("lib", "analyticsEvents.ts");

/**
 * The seams an event can leave through. `trackEvent` is the browser beacon,
 * `useLoopMoment` the shared once-per-surface latch the six loop moments ride,
 * `trackMeaningfulCoreAction` the roll-up, and the two server names are how a
 * verified outcome is minted and forwarded. A file naming an event but none of
 * these is describing the event, not sending it.
 */
const EMITTER_SEAM =
  /\btrackEvent\b|\buseLoopMoment\b|\btrackMeaningfulCoreAction\b|\bmintVerifiedAnalyticsToken\b|\bcapturePosthogEvent\b/;

function sourceFiles(): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
      const relative = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(relative);
        continue;
      }
      if (!/\.(ts|tsx)$/.test(entry.name)) continue;
      if (relative === REGISTRY) continue;
      found.push(relative);
    }
  };
  for (const root of SOURCE_ROOTS) walk(root);
  return found;
}

const emitterSources = sourceFiles()
  .map((relative) => readFileSync(join(ROOT, relative), "utf8"))
  .filter((source) => EMITTER_SEAM.test(source));

describe("every registered analytics event has an emitter", () => {
  it("finds an emitter seam naming each one", () => {
    expect(emitterSources.length).toBeGreaterThan(0);
    const orphans = Object.keys(ANALYTICS_EVENTS).filter(
      (name) => !emitterSources.some((source) => source.includes(`"${name}"`)),
    );
    expect(
      orphans,
      `registered with no emitter (add the emitter in this commit, or drop the name): ${orphans.join(", ")}`,
    ).toEqual([]);
  });

  it("keeps the 18 orphans deleted rather than switched off", () => {
    // Named one by one on purpose. A future commit that re-adds any of them
    // must bring its emitter, and this row goes with it.
    const retired = [
      "cmdk_open",
      "drop_logged",
      "planned_night_status_changed",
      "pub_pal_adopted",
      "pub_pal_memory_changed",
      "planning_handoff_preserved",
      "map_search_ran",
      "guest_plan_participated",
      "district_catalogue_viewed",
      "district_viewed",
      "district_route_blocked",
      "district_route_ready_selected",
      "route_ready_gate_failed",
      "claim_started",
      "claim_completed",
      "open_plan_posted",
      "open_plan_join_requested",
      "open_plan_join_decided",
    ];
    expect(retired).toHaveLength(18);
    for (const name of retired) {
      expect(name in ANALYTICS_EVENTS, `${name} is back without an emitter`).toBe(false);
    }
  });

  it("would catch a name nothing sends", () => {
    // The fence's own proof: a registered-shaped name that no source mentions
    // must fail the sweep, or the test above is asserting nothing.
    const invented = "district_catalogue_viewed";
    expect(emitterSources.some((source) => source.includes(`"${invented}"`))).toBe(false);
  });
});
