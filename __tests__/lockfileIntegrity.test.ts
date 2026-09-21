import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("committed dependency lock", () => {
  it("is strict JSON and records the current root dependency requirements", () => {
    const manifest = JSON.parse(readFileSync("package.json", "utf8"));
    const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));
    expect(lock.packages[""].dependencies).toEqual(manifest.dependencies);
    expect(lock.packages[""].devDependencies).toEqual(manifest.devDependencies);
  });
});
