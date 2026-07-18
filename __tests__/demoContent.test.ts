import { afterEach, describe, expect, it } from "vitest";

import { ambientPresenceCurve } from "@/lib/ambientPresence";
import { demoContentEnabled } from "@/lib/demoContent";
import { demoDropsFor, demoPintDropsForCity } from "@/lib/pintDropSeeds";

const FLAG = "NEXT_PUBLIC_DEMO_CONTENT";
const original = process.env[FLAG];

afterEach(() => {
  if (original === undefined) delete process.env[FLAG];
  else process.env[FLAG] = original;
});

describe("demo content kill switch", () => {
  it("test baseline is hermetic: ambient deployment env cannot flip the flag", () => {
    // vitest.setup.ts strips NEXT_PUBLIC_DEMO_CONTENT (Production sets it to
    // "off" and `npm run ci` runs vitest inside that build). If this fails,
    // the setup stopped pinning the baseline and seed tests depend on
    // whichever environment the suite happens to run in.
    expect(original).toBeUndefined();
    expect(demoContentEnabled()).toBe(true);
  });

  it("defaults ON — behavior unchanged until the owner flips it", () => {
    delete process.env[FLAG];
    expect(demoContentEnabled()).toBe(true);
    expect(demoPintDropsForCity("london").length).toBeGreaterThan(0);
  });

  it("off silences seeded drops for every read path", () => {
    process.env[FLAG] = "off";
    expect(demoContentEnabled()).toBe(false);
    expect(demoPintDropsForCity("london")).toEqual([]);
    expect(demoPintDropsForCity("manchester")).toEqual([]);
    expect(demoDropsFor("venue-16pnwmm")).toEqual([]);
  });

  it("off zeroes ambient presence at peak hours", () => {
    process.env[FLAG] = "off";
    // 22:00 London on a Friday sits inside the busiest HOUR_BAND.
    expect(ambientPresenceCurve("venue-16pnwmm", new Date("2026-07-17T21:00:00Z"))).toBe(0);
  });

  it("only the literal 'off' disables — anything else stays on", () => {
    process.env[FLAG] = "false";
    expect(demoContentEnabled()).toBe(true);
  });
});
