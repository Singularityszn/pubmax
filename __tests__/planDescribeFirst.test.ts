import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { DESCRIBE_FIRST_CHIPS } from "@/components/plan/PlanDescribeFirst";
import { DESCRIBE_FIRST_CHIP_KEYS } from "@/lib/analyticsEvents";

// Chips are promises of a priced three-stop route. Shipping an unverified
// example that 422s is a lie — this fence holds the verified set and the
// voice rules the surface owes.

describe("PlanDescribeFirst occasion chips", () => {
  it("keeps analytics chip keys aligned one-to-one with shipped queries", () => {
    expect(DESCRIBE_FIRST_CHIP_KEYS).toHaveLength(DESCRIBE_FIRST_CHIPS.length);
    expect(DESCRIBE_FIRST_CHIP_KEYS).toContain("coffee_clapham");
    expect(DESCRIBE_FIRST_CHIP_KEYS).toContain("chill_spoons_clapham");
  });

  it("keeps at least two classic night chips that already generate", () => {
    expect(DESCRIBE_FIRST_CHIPS).toContain("Quiet in Clapham for 4, not pricey");
    expect(DESCRIBE_FIRST_CHIPS).toContain("cheap pints tonight in Shoreditch");
  });

  it("offers coffee, food, chill and alcohol-free occasions beside the classics", () => {
    expect(DESCRIBE_FIRST_CHIPS).toContain("alcohol-free drinks in Camden for 3");
    expect(DESCRIBE_FIRST_CHIPS).toContain("quiet afternoon in Clapham for 2, soft drinks");
    expect(DESCRIBE_FIRST_CHIPS).toContain("food then a soft drink in Shoreditch for 4");
    expect(DESCRIBE_FIRST_CHIPS).toContain("coffee and a catch-up in Clapham for 2");
    expect(DESCRIBE_FIRST_CHIPS).toContain("chill Wetherspoons in Clapham for 3");
  });

  it("never ships the Zone 2 Spoons chip that 422s without an area", () => {
    expect(DESCRIBE_FIRST_CHIPS.join("\n")).not.toMatch(/Zone 2/i);
  });

  it("stays VOICE-clean on the describe-first surface", () => {
    const source = readFileSync(
      join(process.cwd(), "components/plan/PlanDescribeFirst.tsx"),
      "utf8",
    );
    expect(source).not.toMatch(/\u2014|\u2013/);
    for (const chip of DESCRIBE_FIRST_CHIPS) {
      expect(chip).not.toMatch(/\u2014|\u2013/);
      expect(chip).not.toMatch(/!/);
    }
    expect(source).toContain("Describe the outing");
    expect(source).toContain("Make a plan");
    expect(source).toContain("What&rsquo;s the plan?");
  });
});
