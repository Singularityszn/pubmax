import { describe, expect, it } from "vitest";
import {
  INITIAL_SLIM_LOAD_LIFECYCLE,
  transitionSlimLoadLifecycle,
  type SlimLoadLifecycleEvent,
  type SlimLoadLifecycleState,
} from "@/lib/slimLoadLifecycle";

const activePhases = ["fetching", "landed", "retrying"] as const;
const events: SlimLoadLifecycleEvent[] = [
  { type: "hold", id: 1 },
  { type: "release", id: 1 },
  { type: "rejoin" },
  { type: "landed" },
  { type: "reopen" },
  { type: "check-unread" },
  { type: "failed" },
  { type: "settled" },
];

describe("slim load lifecycle", () => {
  it("starts with an unread request and no readers", () => {
    expect(INITIAL_SLIM_LOAD_LIFECYCLE).toEqual({ phase: "fetching", holds: [], shared: false });
  });

  describe.each(activePhases)("a %s load", (phase) => {
    const state = { phase, holds: [1, 2], shared: false } satisfies SlimLoadLifecycleState;

    it("adds an independent hold without mutating the previous state", () => {
      expect(transitionSlimLoadLifecycle(state, { type: "hold", id: 3 })).toEqual({
        state: { ...state, holds: [1, 2, 3] }, effects: [],
      });
      expect(state.holds).toEqual([1, 2]);
    });

    it("refuses a duplicate hold or an unknown release", () => {
      for (const event of [{ type: "hold", id: 1 }, { type: "release", id: 3 }] as const) {
        const result = transitionSlimLoadLifecycle(state, event);
        expect(result.state).toBe(state);
        expect(result.effects).toEqual([]);
      }
    });

    it("releases each hold once and defers the unread check", () => {
      const released = transitionSlimLoadLifecycle(state, { type: "release", id: 1 });
      expect(released).toEqual({ state: { ...state, holds: [2] }, effects: ["check-unread"] });
      const twice = transitionSlimLoadLifecycle(released.state, { type: "release", id: 1 });
      expect(twice.state).toBe(released.state);
      expect(twice.effects).toEqual([]);
    });

    it("protects a request when an unscoped caller joins", () => {
      const shared = transitionSlimLoadLifecycle(state, { type: "rejoin" });
      expect(shared).toEqual({ state: { ...state, shared: true }, effects: [] });
      const again = transitionSlimLoadLifecycle(shared.state, { type: "rejoin" });
      expect(again.state).toBe(shared.state);
      expect(again.effects).toEqual([]);
    });

    it.each(["failed", "settled"] as const)("drops the entry when the promise is %s", (type) => {
      expect(transitionSlimLoadLifecycle(state, { type })).toEqual({
        state: { phase: "settled" }, effects: ["drop-entry"],
      });
    });

    it("keeps a held request during the unread check", () => {
      const result = transitionSlimLoadLifecycle(state, { type: "check-unread" });
      expect(result.state).toBe(state);
      expect(result.effects).toEqual([]);
    });
  });

  it.each(["fetching", "retrying"] as const)("records landed bytes for a %s request", (phase) => {
    const state: SlimLoadLifecycleState = { phase, holds: [1], shared: true };
    expect(transitionSlimLoadLifecycle(state, { type: "landed" })).toEqual({
      state: { ...state, phase: "landed" }, effects: [],
    });
    expect(transitionSlimLoadLifecycle(state, { type: "reopen" }).state).toBe(state);
  });

  it("keeps a payload after its last reader releases", () => {
    const state: SlimLoadLifecycleState = { phase: "landed", holds: [1], shared: false };
    const released = transitionSlimLoadLifecycle(state, { type: "release", id: 1 });
    expect(released.state).toEqual({ ...state, holds: [] });
    const checked = transitionSlimLoadLifecycle(released.state, { type: "check-unread" });
    expect(checked.state).toBe(released.state);
    expect(checked.effects).toEqual([]);
    expect(transitionSlimLoadLifecycle(released.state, { type: "landed" }).state).toBe(released.state);
  });

  it.each(["fetching", "retrying"] as const)("aborts an unread %s request only after the grace check", (phase) => {
    const state: SlimLoadLifecycleState = { phase, holds: [1], shared: false };
    const released = transitionSlimLoadLifecycle(state, { type: "release", id: 1 });
    expect(released.effects).toEqual(["check-unread"]);
    expect(transitionSlimLoadLifecycle(released.state, { type: "check-unread" })).toEqual({
      state: { phase: "aborted" }, effects: ["drop-entry", "abort"],
    });
  });

  it.each(activePhases)("keeps an unscoped %s request with no holds", (phase) => {
    const state: SlimLoadLifecycleState = { phase, holds: [], shared: true };
    const result = transitionSlimLoadLifecycle(state, { type: "check-unread" });
    expect(result.state).toBe(state);
    expect(result.effects).toEqual([]);
  });

  it.each(["hold", "rejoin"] as const)("shares the existing request when a caller uses %s within grace", (type) => {
    const held = transitionSlimLoadLifecycle(INITIAL_SLIM_LOAD_LIFECYCLE, { type: "hold", id: 1 }).state;
    const released = transitionSlimLoadLifecycle(held, { type: "release", id: 1 }).state;
    const rejoined = transitionSlimLoadLifecycle(released, type === "hold" ? { type, id: 2 } : { type }).state;
    const checked = transitionSlimLoadLifecycle(rejoined, { type: "check-unread" });
    expect(checked.state).toBe(rejoined);
    expect(checked.effects).toEqual([]);
  });

  it.each([
    { holds: [1], shared: false },
    { holds: [], shared: true },
  ])("reopens landed bytes while a reader remains: %j", (readers) => {
    const state: SlimLoadLifecycleState = { phase: "landed", ...readers };
    expect(transitionSlimLoadLifecycle(state, { type: "reopen" })).toEqual({
      state: { ...state, phase: "retrying" }, effects: [],
    });
  });

  it("abandons a rejected or stale payload immediately when reopening without readers", () => {
    const state: SlimLoadLifecycleState = { phase: "landed", holds: [], shared: false };
    expect(transitionSlimLoadLifecycle(state, { type: "reopen" })).toEqual({
      state: { phase: "aborted" }, effects: ["drop-entry", "abort"],
    });
  });

  it.each(["aborted", "settled"] as const)("refuses late events after the entry is %s", (phase) => {
    const state: SlimLoadLifecycleState = { phase };
    for (const event of events) {
      const result = transitionSlimLoadLifecycle(state, event);
      expect(result.state).toBe(state);
      expect(result.effects).toEqual([]);
    }
  });
});
