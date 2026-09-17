import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(process.cwd(), "app/pint-index/PintIndex.module.css"), "utf8");

describe("Pint Index mobile clearance", () => {
  it("keeps content above the fixed mobile navigation", () => {
    expect(css).toMatch(
      /@media \(max-width: 640px\)[\s\S]*?\.pintIndexPage\s*\{[^}]*padding:[^;]*var\(--mobile-tab-clearance,\s*72px\)/,
    );
  });
});
