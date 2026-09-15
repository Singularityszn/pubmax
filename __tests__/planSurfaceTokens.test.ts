import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const css = readFileSync(join(process.cwd(), "app/plan/plan.css"), "utf8");

describe("plan surface token palette", () => {
  it("derives the planner accent from semantic theme roles", () => {
    expect(css).toContain("--plan-accent: var(--accent-action);");
    expect(css).toContain("--plan-accent-strong: var(--color-accent-ink);");
    expect(css).toContain("--plan-accent: var(--night-amber);");
    expect(css).toContain("--plan-accent-strong: color-mix(in srgb, var(--night-amber) 78%, var(--ink));");
    expect(css).not.toContain("--plan-accent: #");
    expect(css).not.toContain("--plan-accent-strong: #");
    expect(css).not.toContain("--plan-accent-strong: var(--accent-price-ink);");
  });
});
