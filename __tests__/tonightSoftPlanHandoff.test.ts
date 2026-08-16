import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { TONIGHT_SOFT_PLAN_CHIPS } from "@/lib/planOccasion";

describe("Tonight soft plan handoff", () => {
  const source = readFileSync(
    join(process.cwd(), "app/tonight/TonightClient.tsx"),
    "utf8",
  );

  it("routes quiet pint to plan with a soft occasion deep link", () => {
    expect(source).toContain('chip.id === "quiet"');
    expect(source).toContain('planOccasionHref("quiet", { src: "tonight-vibes" })');
  });

  it("ships coffee, alcohol-free and chill plan chips beside the vibe row", () => {
    expect(source).toContain("TONIGHT_SOFT_PLAN_CHIPS");
    expect(source).toContain('planOccasionHref(chip.id, { src: "tonight-vibes" })');
    for (const chip of TONIGHT_SOFT_PLAN_CHIPS) {
      expect(source).toContain("{chip.label}");
    }
  });

  it("renders an acceptance failure in the row that failed, not above the list", () => {
    const aboveList = source.indexOf("{acceptanceError ?");
    const list = source.indexOf('id="tonight-list"');
    expect(aboveList).toBe(-1);
    expect(source).toContain("tonightRowAcceptanceError");
    expect(source.indexOf("tonightRowAcceptanceError(acceptanceError")).toBeGreaterThan(list);
  });
});
