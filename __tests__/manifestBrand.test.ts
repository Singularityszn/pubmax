import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("installed product metadata", () => {
  it("uses canonical PUBMAX product name", () => {
    const manifest = JSON.parse(
      readFileSync(join(process.cwd(), "public/manifest.webmanifest"), "utf8"),
    ) as { name?: string; short_name?: string };
    expect(manifest.name).toBe("PUBMAX");
    expect(manifest.short_name).toBe("PUBMAX");
  });
});
