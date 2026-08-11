import { execFileSync } from "node:child_process";

import { describe, expect, it } from "vitest";

describe("API error message usage", () => {
  it("does not pass response bodies directly to Error", () => {
    let output = "";
    try {
      output = execFileSync(
        "rg",
        ["-n", "new Error\\(body", "components", "app", "lib", "--glob", "*.ts", "--glob", "*.tsx"],
        { encoding: "utf8" },
      );
    } catch (error) {
      const result = error as { status?: number; stdout?: string };
      if (result.status !== 1) throw error;
      output = result.stdout ?? "";
    }

    expect(output).toBe("");
  });
});
