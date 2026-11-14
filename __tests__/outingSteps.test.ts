import { describe, expect, it } from "vitest";

import {
  OUTING_STEPS_MAX_MS,
  outingStepsWindow,
  parseOutingSteps,
  serializeOutingSteps,
  transitionOutingSteps,
  type OutingStepsSample,
  type OutingStepsState,
} from "@/lib/outingSteps";

const T0 = Date.UTC(2026, 10, 14, 19, 0);
const OFF: OutingStepsState = { phase: "off" };
const android = (counter: number | null, bootCount = 7, continuous = true): OutingStepsSample => ({ platform: "android", counter, bootCount, continuous });
const ios = (steps: number): OutingStepsSample => ({ platform: "ios", steps });

function startAndroid(counter: number | null = 10_000) {
  return transitionOutingSteps(OFF, { type: "start", planId: "p1", owner: "acct-a", at: T0, sample: android(counter, 7, false) });
}

function sample(state: OutingStepsState, at: number, value: OutingStepsSample) {
  return transitionOutingSteps(state, { type: "sample", startedAt: T0, at, sample: value });
}

describe("Android counter sessions", () => {
  it("counts from the hardware counter value seen at start", () => {
    const started = startAndroid();
    expect(started).toMatchObject({ phase: "counting", steps: 0, gap: false });
    expect(sample(started, T0 + 60_000, android(10_420))).toMatchObject({ steps: 420, gap: false });
  });

  it("takes the first reading as the baseline when start had none", () => {
    const later = sample(startAndroid(null), T0 + 60_000, android(9_000));
    expect(sample(later, T0 + 120_000, android(9_150))).toMatchObject({ steps: 150, gap: false });
  });

  it("keeps steps from before a reboot and counts the new boot from zero", () => {
    const before = sample(startAndroid(), T0 + 60_000, android(10_500));
    const after = sample(before, T0 + 120_000, android(80, 8));
    expect(after).toMatchObject({ steps: 580, gap: true });
    expect(sample(after, T0 + 180_000, android(100, 8))).toMatchObject({ steps: 600, gap: true });
  });

  it("does not treat a boot identity that became unknown as a reboot", () => {
    const counted = sample(startAndroid(), T0 + 60_000, android(10_300, -1));
    expect(counted).toMatchObject({ steps: 300, gap: false });
    expect(sample(counted, T0 + 120_000, android(10_350, 7))).toMatchObject({ steps: 350, gap: false });
  });

  it("never adds a whole counter when it falls without a known reboot", () => {
    const before = sample(startAndroid(), T0 + 60_000, android(10_500, -1));
    const fallen = sample(before, T0 + 120_000, android(400, -1));
    expect(fallen).toMatchObject({ steps: 500, gap: true });
    expect(sample(fallen, T0 + 180_000, android(450, -1))).toMatchObject({ steps: 550, gap: true });
  });

  it("never lowers the total when the counter falls but stays above the baseline", () => {
    const before = sample(startAndroid(), T0 + 60_000, android(10_500));
    const fallen = sample(before, T0 + 120_000, android(10_400));
    expect(fallen).toMatchObject({ steps: 500, gap: true });
    expect(sample(fallen, T0 + 180_000, android(10_450))).toMatchObject({ steps: 550, gap: true });
  });

  it("counts nothing extra when a known reboot reports a counter that did not reset", () => {
    const before = sample(startAndroid(), T0 + 60_000, android(10_500));
    const rebooted = sample(before, T0 + 120_000, android(20_000, 8));
    expect(rebooted).toMatchObject({ steps: 500, gap: true });
    expect(sample(rebooted, T0 + 180_000, android(20_040, 8))).toMatchObject({ steps: 540, gap: true });
  });

  it("marks a possible gap when the listener was not running since the last reading", () => {
    const counted = sample(startAndroid(), T0 + 60_000, android(10_300, 7, false));
    expect(counted).toMatchObject({ steps: 300, gap: true });
  });

  it("stops at the cap and never counts steps read after it", () => {
    const counted = sample(startAndroid(), T0 + 60_000, android(10_300));
    const capped = sample(counted, T0 + OUTING_STEPS_MAX_MS + 1, android(19_000));
    expect(capped).toEqual({ phase: "stopped", planId: "p1", owner: "acct-a", startedAt: T0, endedAt: T0 + OUTING_STEPS_MAX_MS, steps: 300, gap: true });
  });

  it("ignores an iOS reading in an Android session", () => {
    const started = startAndroid();
    expect(sample(started, T0 + 1, ios(50))).toBe(started);
  });
});

describe("iOS window sessions", () => {
  const started = transitionOutingSteps(OFF, { type: "start", planId: "p1", owner: "acct-a", at: T0, sample: ios(0) });

  it("asks for steps from the start to now, and never past the cap", () => {
    expect(outingStepsWindow(started, T0 + 1_000)).toEqual({ since: T0, until: T0 + 1_000 });
    expect(outingStepsWindow(started, T0 + OUTING_STEPS_MAX_MS * 2)).toEqual({ since: T0, until: T0 + OUTING_STEPS_MAX_MS });
    expect(outingStepsWindow(OFF, T0)).toBeNull();
  });

  it("uses the system total and never moves backwards", () => {
    const counted = sample(started, T0 + 60_000, ios(800));
    expect(counted).toMatchObject({ steps: 800 });
    expect(sample(counted, T0 + 90_000, ios(700))).toBe(counted);
  });

  it("finishes with the capped system total once the cap has passed", () => {
    const capped = sample(started, T0 + OUTING_STEPS_MAX_MS + 5, ios(9_000));
    expect(capped).toMatchObject({ phase: "stopped", steps: 9_000, gap: false, endedAt: T0 + OUTING_STEPS_MAX_MS });
  });

  it("refuses a malformed reading", () => {
    expect(sample(started, T0 + 1, ios(-3))).toBe(started);
    expect(sample(started, T0 + 1, ios(Number.NaN))).toBe(started);
  });
});

describe("session scope", () => {
  it("ignores a reading or stop from an older session", () => {
    const started = startAndroid();
    expect(transitionOutingSteps(started, { type: "sample", startedAt: T0 - 1, at: T0 + 5, sample: android(10_900) })).toBe(started);
    expect(transitionOutingSteps(started, { type: "stop", startedAt: T0 - 1, at: T0 + 5 })).toBe(started);
  });

  it("refuses a second start while one session is counting", () => {
    const started = startAndroid();
    expect(transitionOutingSteps(started, { type: "start", planId: "p2", owner: "acct-a", at: T0 + 5, sample: android(1) })).toBe(started);
  });

  it("stops with the last count and clamps the end to the cap", () => {
    const counted = sample(startAndroid(), T0 + 60_000, android(10_250));
    expect(transitionOutingSteps(counted, { type: "stop", startedAt: T0, at: T0 + 120_000 })).toMatchObject({ phase: "stopped", steps: 250, endedAt: T0 + 120_000 });
    expect(transitionOutingSteps(counted, { type: "stop", startedAt: T0, at: T0 + OUTING_STEPS_MAX_MS * 3 })).toMatchObject({ endedAt: T0 + OUTING_STEPS_MAX_MS });
  });

  it("clears a finished session", () => {
    const stopped = transitionOutingSteps(startAndroid(), { type: "stop", startedAt: T0, at: T0 + 1 });
    expect(transitionOutingSteps(stopped, { type: "clear" })).toEqual(OFF);
    expect(transitionOutingSteps(OFF, { type: "clear" })).toBe(OFF);
  });
});

describe("local storage", () => {
  it("round-trips a counting and a stopped session", () => {
    const counted = sample(startAndroid(), T0 + 60_000, android(10_250));
    expect(parseOutingSteps(serializeOutingSteps(counted), "acct-a")).toEqual(counted);
    const stopped = transitionOutingSteps(counted, { type: "stop", startedAt: T0, at: T0 + 90_000 });
    expect(parseOutingSteps(serializeOutingSteps(stopped), "acct-a")).toEqual(stopped);
    expect(serializeOutingSteps(OFF)).toBeNull();
  });

  it("shows a stored session only to the account that started it", () => {
    const counted = sample(startAndroid(), T0 + 60_000, android(10_250));
    const raw = serializeOutingSteps(counted);
    expect(parseOutingSteps(raw, "acct-b")).toEqual(OFF);
    expect(parseOutingSteps(raw, null)).toEqual(OFF);
    const guest = transitionOutingSteps(OFF, { type: "start", planId: "p1", owner: null, at: T0, sample: ios(0) });
    expect(parseOutingSteps(serializeOutingSteps(guest), "acct-a")).toEqual(OFF);
    expect(parseOutingSteps(serializeOutingSteps(guest), null)).toEqual(guest);
  });

  it("reads anything unknown or damaged as no session", () => {
    for (const raw of [null, "", "{", "[]", '{"v":2,"phase":"counting"}', '{"v":1,"phase":"counting","planId":"p","startedAt":1,"steps":-1,"gap":false,"counter":null}']) {
      expect(parseOutingSteps(raw, "acct-a")).toEqual(OFF);
    }
  });
});
