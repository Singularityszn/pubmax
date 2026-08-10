import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

type Lockfile = {
  packages?: Record<string, { version?: string }>;
};

const lock = JSON.parse(
  readFileSync("package-lock.json", "utf8"),
) as Lockfile;

describe("production dependency security", () => {
  it("keeps DOMPurify outside the affected GHSA range", () => {
    const version = lock.packages?.["node_modules/dompurify"]?.version;
    expect(version).toBe("3.4.13");
  });

  it("keeps Capacitor's xcode UUID helper outside its affected GHSA range", () => {
    const version = lock.packages?.["node_modules/uuid"]?.version;
    expect(version).toBe("11.1.1");
  });
});
