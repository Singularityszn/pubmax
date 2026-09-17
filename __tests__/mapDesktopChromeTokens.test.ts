import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

const toolbarCss = read("components/map/mapToolbar.module.css");
const layersCss = read("components/map/mapLayersControl.module.css");

function ruleBody(css: string, selector: string): string {
  // Each .className segment may appear bare or wrapped in :global() after
  // the CSS-module migration, e.g. ".mapToolbar" → ":global(.mapToolbar)"
  // and ".mapLayersFab.isActive" → ".mapLayersFab:global(.isActive)".
  const pattern = selector.replace(/\.([a-zA-Z_][\w-]*)/g, (_, cls) => {
    const esc = cls.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return `(?::global\\(\\.${esc}\\)|\\.${esc})`;
  });
  return css.match(new RegExp(`${pattern}\\s*\\{([^}]*)\\}`))?.[1] ?? "";
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
