import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("retired night-out places experiment", () => {
  it("has no runtime route, ingest command, freshness feed, or tracing pack", () => {
    const root = process.cwd();
    expect(existsSync(join(root, "app/api/night-out-places/route.ts"))).toBe(false);
    expect(existsSync(join(root, "scripts/ingest_night_out_places.mjs"))).toBe(false);
    expect(existsSync(join(root, "public/data/night_out_places/latest.json"))).toBe(false);

    for (const path of [
      "package.json",
      "data/freshness_registry.json",
      "lib/venueIndexTracing.mjs",
      "scripts/validate-data.mjs",
    ]) {
      expect(readFileSync(join(root, path), "utf8")).not.toContain("night_out_places");
      expect(readFileSync(join(root, path), "utf8")).not.toContain("night-out-places");
    }
  });
});
