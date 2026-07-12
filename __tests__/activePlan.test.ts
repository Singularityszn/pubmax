import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ACTIVE_PLAN_KEY,
  ACTIVE_PLAN_POST_MS,
  ACTIVE_PLAN_PRE_MS,
  clampStopIndex,
  cleanStopIndex,
  clearActivePlan,
  dismissNightMode,
  isNightModeDismissed,
  isPlanActiveNow,
  markActivePlan,
  parseActivePlan,
  readActivePlan,
  restoreNightMode,
  serializeActivePlan,
  setActivePlanStopIndex,
  writeActivePlan,
} from "@/lib/activePlan";

const PLAN_ID = "6ab5ca40-836b-4970-9477-d1779fdd31ab";
const OTHER_ID = "11111111-2222-4333-8444-555555555555";
const START = "2026-07-16T18:00:00.000Z";

type WindowLike = { localStorage: Storage; sessionStorage: Storage };

function makeMemoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (k: string) => void map.delete(k),
    setItem: (k: string, v: string) => void map.set(k, String(v)),
  };
}

function installWindow(): void {
  const w = globalThis as { window?: WindowLike };
  w.window = { localStorage: makeMemoryStorage(), sessionStorage: makeMemoryStorage() };
  // The lib dispatches DOM events on write; stub so notify() never throws in node.
  (w.window as unknown as { dispatchEvent?: () => boolean }).dispatchEvent = () => true;
}

function clearWindow(): void {
  delete (globalThis as { window?: WindowLike }).window;
}

afterEach(() => {
  clearWindow();
  vi.restoreAllMocks();
});

describe("parseActivePlan", () => {
  it("round-trips a valid pointer through serialize", () => {
    const ref = { id: PLAN_ID, startTime: START, stopIndex: 2 };
    expect(parseActivePlan(serializeActivePlan(ref))).toEqual(ref);
  });

  it("rejects malformed json, non-plan ids, and bad start times", () => {
    expect(parseActivePlan(null)).toBeNull();
    expect(parseActivePlan("")).toBeNull();
    expect(parseActivePlan("{not json")).toBeNull();
    expect(parseActivePlan(JSON.stringify({ id: "nope", startTime: START }))).toBeNull();
    expect(parseActivePlan(JSON.stringify({ id: PLAN_ID, startTime: "not-a-date" }))).toBeNull();
  });

  it("defaults a missing/invalid stopIndex to 0", () => {
    expect(parseActivePlan(JSON.stringify({ id: PLAN_ID, startTime: START }))?.stopIndex).toBe(0);
    expect(
      parseActivePlan(JSON.stringify({ id: PLAN_ID, startTime: START, stopIndex: -4 }))?.stopIndex,
    ).toBe(0);
  });
});

describe("cursor helpers", () => {
  it("cleanStopIndex floors to a non-negative integer", () => {
    expect(cleanStopIndex(3.9)).toBe(3);
    expect(cleanStopIndex(-1)).toBe(0);
    expect(cleanStopIndex("2")).toBe(2);
    expect(cleanStopIndex("x")).toBe(0);
  });

  it("clampStopIndex keeps the cursor inside the real stop list", () => {
    expect(clampStopIndex(0, 3)).toBe(0);
    expect(clampStopIndex(5, 3)).toBe(2);
    expect(clampStopIndex(1, 0)).toBe(0);
  });
});

describe("isPlanActiveNow", () => {
  const start = Date.parse(START);

  it("is inactive with no ref or unparseable start", () => {
    expect(isPlanActiveNow(null, start)).toBe(false);
    expect(isPlanActiveNow({ id: PLAN_ID, startTime: "bad", stopIndex: 0 }, start)).toBe(false);
  });

  it("is active within the [start-PRE, start+POST] window and not outside it", () => {
    const ref = { id: PLAN_ID, startTime: START, stopIndex: 0 };
    expect(isPlanActiveNow(ref, start)).toBe(true);
    expect(isPlanActiveNow(ref, start - ACTIVE_PLAN_PRE_MS + 1)).toBe(true);
    expect(isPlanActiveNow(ref, start + ACTIVE_PLAN_POST_MS - 1)).toBe(true);
    expect(isPlanActiveNow(ref, start - ACTIVE_PLAN_PRE_MS - 1)).toBe(false);
    expect(isPlanActiveNow(ref, start + ACTIVE_PLAN_POST_MS + 1)).toBe(false);
  });
});

describe("storage round-trip", () => {
  beforeEach(() => installWindow());

  it("reads null when unset and writes/reads a pointer", () => {
    expect(readActivePlan()).toBeNull();
    writeActivePlan({ id: PLAN_ID, startTime: START, stopIndex: 1 });
    expect(readActivePlan()).toEqual({ id: PLAN_ID, startTime: START, stopIndex: 1 });
    expect(window.localStorage.getItem(ACTIVE_PLAN_KEY)).toContain(PLAN_ID);
  });

  it("ignores invalid writes", () => {
    writeActivePlan({ id: "nope", startTime: START, stopIndex: 0 });
    expect(readActivePlan()).toBeNull();
  });

  it("markActivePlan resets stopIndex for a new plan but preserves it on revisit", () => {
    markActivePlan(PLAN_ID, START);
    setActivePlanStopIndex(2);
    expect(readActivePlan()?.stopIndex).toBe(2);
    markActivePlan(PLAN_ID, START); // same plan → keep the walked cursor
    expect(readActivePlan()?.stopIndex).toBe(2);
    markActivePlan(OTHER_ID, START); // new plan → reset
    expect(readActivePlan()).toEqual({ id: OTHER_ID, startTime: START, stopIndex: 0 });
  });

  it("clearActivePlan honours onlyIfId", () => {
    markActivePlan(PLAN_ID, START);
    clearActivePlan(OTHER_ID);
    expect(readActivePlan()?.id).toBe(PLAN_ID);
    clearActivePlan(PLAN_ID);
    expect(readActivePlan()).toBeNull();
  });

  it("returns null on SSR (no window)", () => {
    clearWindow();
    expect(readActivePlan()).toBeNull();
    writeActivePlan({ id: PLAN_ID, startTime: START, stopIndex: 0 });
    expect(readActivePlan()).toBeNull();
  });
});

describe("dismissal (session-scoped, per plan)", () => {
  beforeEach(() => installWindow());

  it("dismiss/restore toggles per plan id", () => {
    expect(isNightModeDismissed(PLAN_ID)).toBe(false);
    dismissNightMode(PLAN_ID);
    expect(isNightModeDismissed(PLAN_ID)).toBe(true);
    expect(isNightModeDismissed(OTHER_ID)).toBe(false); // isolated per plan
    restoreNightMode(PLAN_ID);
    expect(isNightModeDismissed(PLAN_ID)).toBe(false);
  });

  it("ignores non-plan ids and never throws on blocked storage", () => {
    expect(isNightModeDismissed("nope")).toBe(false);
    vi.spyOn(window.sessionStorage, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => dismissNightMode(PLAN_ID)).not.toThrow();
  });
});
