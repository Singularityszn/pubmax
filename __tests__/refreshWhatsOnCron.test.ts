import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("What's-On freshness cron", () => {
  const source = readFileSync(
    join(process.cwd(), "app/api/cron/refresh-whats-on/route.ts"),
    "utf8",
  );

  it("does not turn request time into source freshness", () => {
    expect(source).not.toMatch(/result\.asOf\s*\?\?\s*result\.servedAt/);
    expect(source).toContain("freshnessAdvanced");
  });
});
