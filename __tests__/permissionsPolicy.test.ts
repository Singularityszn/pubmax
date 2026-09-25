import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..");

describe("Permissions-Policy security header", () => {
  it("allows microphone on the app origin for Pub Pal voice", () => {
    const source = readFileSync(join(ROOT, "next.config.mjs"), "utf8");
    expect(source).toMatch(/microphone=\(self\)/);
    expect(source).not.toMatch(/microphone=\(\)/);
  });
});
