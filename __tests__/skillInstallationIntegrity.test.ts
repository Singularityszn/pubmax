import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("installed skill integrity", () => {
  it("keeps continual learning self-contained and approval-gated", () => {
    const skill = readFileSync(
      join(process.cwd(), ".agents", "skills", "continual-learning", "SKILL.md"),
      "utf8",
    );

    expect(skill).not.toContain("agents-memory-updater");
    expect(skill).toMatch(/Wait for explicit approval/);
    expect(skill).toMatch(/Never read transcripts outside current workspace/);
  });
});
