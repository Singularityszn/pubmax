import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

const toolbarCss = read("components/map/mapToolbar.css");
const layersCss = read("components/map/mapLayersControl.css");

function ruleBody(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return css.match(new RegExp(`${escaped}\\s*{([^}]*)}`))?.[1] ?? "";
}

describe("desktop map passive chrome", () => {
  it("keeps the toolbar on a flat raised surface", () => {
    expect(ruleBody(toolbarCss, ".mapToolbar")).toContain(
      "background: var(--color-surface-raised);",
    );
    expect(ruleBody(toolbarCss, ".mapToolbar")).toContain(
      "background: var(--color-surface-raised);",
    );
    expect(ruleBody(toolbarCss, ".mapToolbar")).not.toMatch(
      /background:\s*linear-gradient/,
    );
  });

  it("keeps the Layers control neutral until it is active", () => {
    const fab = ruleBody(layersCss, ".mapLayersFab");
    expect(fab).toContain(
      "border: 1px solid var(--control-secondary-border, var(--color-border));",
    );
    expect(fab).toContain(
      "background: var(--control-secondary-surface, var(--color-surface-raised));",
    );
    expect(fab).not.toMatch(/background:\s*linear-gradient/);
    expect(ruleBody(layersCss, ".mapLayersFab.isActive")).toContain(
      "background: var(--color-accent);",
    );
  });
});
