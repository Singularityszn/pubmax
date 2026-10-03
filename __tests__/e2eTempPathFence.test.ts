import { execFileSync } from "node:child_process";

import { describe, expect, it } from "vitest";

describe("e2e evidence paths", () => {
  it("never writes a fixed shared temp path", () => {
    // git grep exits 1 with no output when nothing matches. Any other failure
    // is a tooling problem and must not read as a pass.
    let hits: string;
    try {
      hits = execFileSync("git", ["grep", "-n", "/tmp/pubmax-", "--", "e2e"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      const failure = error as { status?: number; stdout?: string };
      if (failure.status !== 1) throw error;
      hits = failure.stdout ?? "";
    }
    expect(hits).toBe("");
  });
});
