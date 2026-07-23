import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("MusicTonightLane (W4)", () => {
  const source = readFileSync(
    join(process.cwd(), "components/discovery/MusicTonightLane.tsx"),
    "utf8",
  );

  it("consumes the music what's-on spine with thin-coverage honesty", () => {
    expect(source).toMatch(/\/api\/whats-on\?kind=music/);
    expect(source).toMatch(/Thin coverage tonight/);
    expect(source).toMatch(/THIN_COVERAGE_MAX/);
    expect(source).not.toMatch(/\u2014/);
  });
});

describe("TonightMapPointer (W1 Discover absorb)", () => {
  const source = readFileSync(
    join(process.cwd(), "components/discovery/TonightMapPointer.tsx"),
    "utf8",
  );

  it("points Discover at the map Tonight lane instead of CityMCP", () => {
    expect(source).toMatch(/\/map\?src=discover-tonight/);
    expect(source).toMatch(/whats_on_filter/);
  });
});
