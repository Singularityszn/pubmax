import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const packageJson = JSON.parse(
  readFileSync(path.join(__dirname, "..", "package.json"), "utf8"),
) as { scripts?: Record<string, string> };

describe("build scripts", () => {
  it("regenerates bundled data artifacts before the production build", () => {
    expect(packageJson.scripts?.prebuild).toBe(
      "npm run build:slim && npm run build:pubmaxxing-seed",
    );
  });

  it("regenerates bundled data artifacts before data validation", () => {
    expect(packageJson.scripts?.["prevalidate-data"]).toBe(
      "npm run build:slim && npm run build:pubmaxxing-seed",
    );
  });
});
