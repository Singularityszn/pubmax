import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("PlanComposer describe deep link", () => {
  it("prefills from URL occasion params before the Ask draft seam", () => {
    const source = readFileSync(
      join(process.cwd(), "components/plan/PlanComposer.tsx"),
      "utf8",
    );
    const effectBlock = source.match(
      /askDraftConsumedRef[\s\S]*?}, \[\]\);/,
    )?.[0];
    expect(effectBlock).toBeTruthy();
    expect(effectBlock).toContain("parsePlanDescribeFromSearch");
    expect(effectBlock).toContain("const fromUrl = parsePlanDescribeFromSearch(window.location.search)");
    expect(effectBlock!.indexOf("const fromUrl")).toBeLessThan(
      effectBlock!.indexOf("ASK_PLAN_DRAFT_STORAGE_KEY"),
    );
  });
});
