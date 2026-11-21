// The /pal performance ceiling records removal of the eager voice SDK.

import { describe, expect, it } from "vitest";

import { PERFORMANCE_BUDGETS } from "@/lib/performanceBudgets";

describe("the ceiling records the removal", () => {
  it("ratchets /pal down, and raises nothing", () => {
    const pal = PERFORMANCE_BUDGETS.routes.find((route) => route.path === "/pal");
    // Seeded at 1800 against a 1745 measurement that included the SDK.
    expect(pal?.jsDecodedKB).toBeLessThanOrEqual(1300);
    expect(pal?.why).toContain("603");
  });
});
