import { describe, expect, it } from "vitest";

import { nowTabHref } from "@/components/nav/navigationModel";

// The Now tab keeps both /today and /tonight live and only flips the TAB
// href. 17:00 Europe/London is the cut. Winter (GMT) and summer (BST) both
// have to land on the same wall-clock hour, so these instants are pinned in
// UTC to those two London clocks.

describe("nowTabHref", () => {
  it("points at /today before 17:00 Europe/London in winter", () => {
    expect(nowTabHref(new Date("2026-01-15T16:59:00Z"))).toBe("/today");
  });

  it("points at /tonight from 17:00 Europe/London in winter", () => {
    expect(nowTabHref(new Date("2026-01-15T17:00:00Z"))).toBe("/tonight");
  });

  it("points at /today before 17:00 Europe/London in summer", () => {
    // 16:59 BST = 15:59 UTC
    expect(nowTabHref(new Date("2026-08-16T15:59:00Z"))).toBe("/today");
  });

  it("points at /tonight from 17:00 Europe/London in summer", () => {
    // 17:00 BST = 16:00 UTC
    expect(nowTabHref(new Date("2026-08-16T16:00:00Z"))).toBe("/tonight");
  });
});
