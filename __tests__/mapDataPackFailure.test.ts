// A FAILING /data PACK IS NOT A FAILING BASEMAP, AND IT MAY NOT SPEND ONE.
//
// `map.on("error")` hears both through one channel. Before this lane, an HTTP
// failure on `tube-lines` - our own `/data/tfl_lines.json`, which MapLibre
// fetches itself - landed a stamp in the tile-failure burst window and could
// therefore reach the verdict that spends the mount's ONE style reload. That
// reload rebuilds every source and re-asks for the same file, so a single 500
// could end with the basemap error card over a map whose basemap was fine.
// This is the policy that keeps the two apart. See lib/mapDataPackFailure.ts.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  APP_DATA_PACK_SOURCE_IDS,
  DATA_PACK_RETRY_DELAY_MS,
  INITIAL_DATA_PACK_SPEND,
  appDataPackSourceId,
  dataPackDegraded,
  spendDataPackFailure,
} from "@/lib/mapDataPackFailure";

describe("app data pack identity", () => {
  it("claims only the sources MapLibre fetches for us", () => {
    expect(APP_DATA_PACK_SOURCE_IDS).toEqual(["tube-lines"]);
    expect(appDataPackSourceId("tube-lines")).toBe("tube-lines");
  });

  it("claims no basemap source and nothing malformed", () => {
    for (const other of ["openmaptiles", "carto", "pubs", "uk-base", "pois"]) {
      expect(appDataPackSourceId(other)).toBeNull();
    }
    expect(appDataPackSourceId(undefined)).toBeNull();
    expect(appDataPackSourceId(null)).toBeNull();
    expect(appDataPackSourceId(7)).toBeNull();
  });
});

describe("spending one pack failure", () => {
  it("retries once, then degrades, then stays quiet", () => {
    const first = spendDataPackFailure(INITIAL_DATA_PACK_SPEND, "tube-lines");
    expect(first.effect).toBe("retry");
    expect(dataPackDegraded(first.state, "tube-lines")).toBe(false);

    const second = spendDataPackFailure(first.state, "tube-lines");
    expect(second.effect).toBe("degrade");
    expect(dataPackDegraded(second.state, "tube-lines")).toBe(true);

    const third = spendDataPackFailure(second.state, "tube-lines");
    expect(third.effect).toBe("none");
    expect(third.state).toBe(second.state);

    const fourth = spendDataPackFailure(third.state, "tube-lines");
    expect(fourth.effect).toBe("none");
  });

  it("never mutates the state it was handed", () => {
    const spent = spendDataPackFailure(INITIAL_DATA_PACK_SPEND, "tube-lines");
    expect(INITIAL_DATA_PACK_SPEND.retried).toEqual([]);
    expect(INITIAL_DATA_PACK_SPEND.degraded).toEqual([]);
    expect(spent.state).not.toBe(INITIAL_DATA_PACK_SPEND);
  });

  it("waits before the retry rather than re-asking inside the same failure", () => {
    expect(DATA_PACK_RETRY_DELAY_MS).toBeGreaterThan(0);
  });
});

// The policy above is only worth anything if the handler asks it FIRST. The bug
// was the wiring, not the arithmetic, so the wiring is what is fenced: this
// reads the shipped source the way the map's other specs already read it, and
// fails if a pack error can reach `tileFailureStamps.push`.
describe("the canvas asks the pack lane before the tile lane", () => {
  const source = readFileSync(
    join(process.cwd(), "components", "PubMapCanvas.tsx"),
    "utf8",
  );
  const handler = source.slice(
    source.indexOf('map.on("error", (event) => {'),
    source.indexOf("evaluateTileFailure(\n        now,"),
  );

  it("routes a pack failure out of the handler before any stamp is taken", () => {
    expect(handler).toContain("appDataPackSourceId(mapError.sourceId)");
    expect(handler.indexOf("recoverDataPack(dataPackSourceId, message)")).
      toBeLessThan(handler.indexOf("tileFailureStamps.push(now)"));
    expect(handler.indexOf("appDataPackSourceId")).toBeLessThan(
      handler.indexOf("performance.now()"),
    );
  });

  it("degrades the pack instead of reloading the style", () => {
    const lane = source.slice(
      source.indexOf("let dataPackSpend = INITIAL_DATA_PACK_SPEND"),
      source.indexOf("const evaluateTileFailure = ("),
    );
    expect(lane).toContain("setData(EMPTY_DATA_PACK)");
    expect(lane).not.toContain("setProtectedStyle");
    expect(lane).not.toContain("surfaceBasemapFailure");
    expect(lane).not.toContain("recoverySpent");
  });
});
