import { describe, expect, it } from "vitest";

import {
  countsTowardDutyCensus,
  DUTY_CENSUS_RISES_AT,
  DUTY_CENSUS_STARTS_AT,
  dutyCensusShownCount,
  dutyCensusView,
  type DutyCensusDrop,
} from "@/lib/dutyCensus";

const START = Date.parse(DUTY_CENSUS_STARTS_AT);
const RISE = Date.parse(DUTY_CENSUS_RISES_AT);
const HOUR = 3_600_000;

function drop(overrides: Partial<DutyCensusDrop> = {}): DutyCensusDrop {
  return {
    status: "visible",
    visibility: "public",
    priceGbp: 5.4,
    provenance: "contributor",
    createdAt: new Date(START + HOUR).toISOString(),
    ...overrides,
  };
}

describe("countsTowardDutyCensus", () => {
  it("counts a public or anonymous priced drop logged inside the window", () => {
    expect(countsTowardDutyCensus(drop())).toBe(true);
    expect(countsTowardDutyCensus(drop({ visibility: "anonymous" }))).toBe(true);
    expect(countsTowardDutyCensus(drop({ visibility: undefined }))).toBe(true);
    expect(countsTowardDutyCensus(drop({ createdAt: DUTY_CENSUS_STARTS_AT }))).toBe(true);
  });

  it("never counts a drop a stranger cannot read", () => {
    expect(countsTowardDutyCensus(drop({ visibility: "friends" }))).toBe(false);
    expect(countsTowardDutyCensus(drop({ visibility: "legacy" }))).toBe(false);
    expect(countsTowardDutyCensus(drop({ status: "hidden" }))).toBe(false);
  });

  it("never counts a demo row or a drop with no price", () => {
    expect(countsTowardDutyCensus(drop({ provenance: "demo" }))).toBe(false);
    expect(countsTowardDutyCensus(drop({ priceGbp: null }))).toBe(false);
    expect(countsTowardDutyCensus(drop({ priceGbp: 0 }))).toBe(false);
    expect(countsTowardDutyCensus(drop({ priceGbp: Number.NaN }))).toBe(false);
  });

  it("counts only the window from the start day up to the rise", () => {
    expect(countsTowardDutyCensus(drop({ createdAt: new Date(START - 1).toISOString() }))).toBe(false);
    expect(countsTowardDutyCensus(drop({ createdAt: new Date(RISE - 1).toISOString() }))).toBe(true);
    expect(countsTowardDutyCensus(drop({ createdAt: DUTY_CENSUS_RISES_AT }))).toBe(false);
  });
});

describe("dutyCensusShownCount", () => {
  it("prints no figure under three and never pads one", () => {
    expect(dutyCensusShownCount(null)).toBeNull();
    expect(dutyCensusShownCount(0)).toBeNull();
    expect(dutyCensusShownCount(2)).toBeNull();
    expect(dutyCensusShownCount(2.5)).toBeNull();
    expect(dutyCensusShownCount(3)).toBe(3);
    expect(dutyCensusShownCount(1204)).toBe(1204);
  });
});

describe("dutyCensusView", () => {
  it("stands down once the rise falls inside the hold", () => {
    expect(dutyCensusView(RISE - 2 * HOUR, 12, HOUR)).not.toBeNull();
    expect(dutyCensusView(RISE - HOUR / 2, 12, HOUR)).toBeNull();
    expect(dutyCensusView(RISE - HOUR / 2, 12)).not.toBeNull();
    expect(dutyCensusView(RISE, 12)).toBeNull();
  });

  it("stamps a held figure and leaves a live one or a hidden one unstamped", () => {
    const now = START + 9 * 24 * HOUR;
    expect(dutyCensusView(now, 12, HOUR)?.countedAt).toEqual(expect.any(String));
    expect(dutyCensusView(now, 12)?.countedAt).toBeNull();
    expect(dutyCensusView(now, 2, HOUR)).toMatchObject({ count: null, countedAt: null });
  });

  it("places today on the window, held at its ends", () => {
    expect(dutyCensusView(START - 24 * HOUR, null)?.elapsed).toBe(0);
    expect(dutyCensusView((START + RISE) / 2, null)?.elapsed).toBeCloseTo(0.5);
  });
});
