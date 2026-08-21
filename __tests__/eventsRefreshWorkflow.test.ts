import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("What's-On events refresh workflow", () => {
  it("builds generated venue details before refresh validation", () => {
    const workflow = readFileSync(
      join(process.cwd(), ".github/workflows/events-refresh.yml"),
      "utf8",
    );
    const build = workflow.indexOf("npm run build:slim");
    const refresh = workflow.indexOf("npm run refresh:events -- --with-common --open-pr");

    expect(build).toBeGreaterThan(-1);
    expect(refresh).toBeGreaterThan(build);
  });
});
