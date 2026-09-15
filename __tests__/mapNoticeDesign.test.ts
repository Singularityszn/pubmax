import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const read = (file: string): string => readFileSync(join(process.cwd(), file), "utf8");

function rule(css: string, selector: string): string {
  return css.match(new RegExp(`${selector}\\s*\\{([^}]*)\\}`))?.[1] ?? "";
}

describe("map notice surfaces", () => {
  it("keeps ambient notices on flat token surfaces", () => {
    const status = read("components/map/cityStatusBanner.css");
    const suggest = read("components/map/citySuggestBanner.css");

    for (const [css, selector] of [
      [status, "\\.cityStatusBanner"],
      [suggest, "\\.citySuggestBanner"],
    ] as const) {
      const block = rule(css, selector);
      expect(block).toContain("background: var(--panel-raised)");
      expect(block).toContain("backdrop-filter: none");
      expect(block).toContain("-webkit-backdrop-filter: none");
      expect(block).not.toContain("linear-gradient");
    }
  });

  it("uses the shared sheet radius for notice containers", () => {
    const status = read("components/map/cityStatusBanner.css");
    const suggest = read("components/map/citySuggestBanner.css");

    expect(rule(status, "\\.cityStatusSignalSheet")).toContain(
      "border-radius: var(--radius-lg)",
    );
    expect(status).toContain("border-radius: var(--radius-lg);");
    expect(suggest).toContain("border-radius: var(--radius-lg);");
  });
});
