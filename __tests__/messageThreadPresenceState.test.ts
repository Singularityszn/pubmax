import { describe, expect, it } from "vitest";
import { INITIAL_THREAD_PRESENCE, transitionThreadPresence, type ThreadPresenceState, type ThreadPresenceEvent } from "@/lib/messageThreadPresenceState";

const binding = { token: "device", bearer: "session" };
const lease = { ...binding, activityId: 17 };
const states: ThreadPresenceState[] = [
  INITIAL_THREAD_PRESENCE,
  { phase: "loading", revision: 1 },
  { phase: "reserving", revision: 1, binding },
  { phase: "visible", revision: 1, lease },
  { phase: "hidden", revision: 2, lease },
  { phase: "stopped", revision: 3, lease },
];

describe("asynchronous thread presence transitions", () => {
  it.each(states)("refuses stale async completions without allocation in $phase", state => {
    for (const event of [
      { type: "credentials", revision: 99, binding },
      { type: "reserved", revision: 99, activityId: 18 },
      { type: "failed", revision: 99 },
      { type: "delivered", revision: 99 },
      { type: "notifications-loaded", revision: 99 },
    ] satisfies ThreadPresenceEvent[]) {
      const result = transitionThreadPresence(state, event);
      expect(result.state).toBe(state);
      expect(result.effects).toEqual([]);
    }
  });
  it("resolves, reserves, sends, clears and resumes within one ordered lifetime", () => {
    let state = transitionThreadPresence(INITIAL_THREAD_PRESENCE, { type: "refresh" }).state;
    expect(state.phase).toBe("loading");
    expect(transitionThreadPresence(state, { type: "refresh" }).state).toBe(state);
    state = transitionThreadPresence(state, { type: "credentials", revision: 1, binding }).state;
    expect(state.phase).toBe("reserving");
    state = transitionThreadPresence(state, { type: "reserved", revision: 1, activityId: 17 }).state;
    expect(state).toEqual({ phase: "visible", revision: 1, lease });
    state = transitionThreadPresence(state, { type: "hide" }).state;
    expect(state).toEqual({ phase: "hidden", revision: 2, lease });
    expect(transitionThreadPresence(state, { type: "hide" }).state).toBe(state);
    state = transitionThreadPresence(state, { type: "refresh" }).state;
    state = transitionThreadPresence(state, { type: "credentials", revision: 3, binding }).state;
    expect(state.phase).toBe("reserving");
    state = transitionThreadPresence(state, { type: "reserved", revision: 3, activityId: 18 }).state;
    expect(state).toEqual({ phase: "visible", revision: 3, lease: { ...lease, activityId: 18 } });
    state = transitionThreadPresence(state, { type: "stop" }).state;
    for (const event of [{ type: "refresh" }, { type: "hide" }, { type: "stop" }] satisfies ThreadPresenceEvent[]) {
      expect(transitionThreadPresence(state, event).state).toBe(state);
    }
  });
  it("requires a new reservation when the credential changes on the same device", () => {
    const loading = transitionThreadPresence(states[3]!, { type: "refresh" }).state;
    const next = transitionThreadPresence(loading, { type: "credentials", revision: 2, binding: { ...binding, bearer: "new-session" } });
    expect(next.state.phase).toBe("reserving");
    expect(next.effects.some(effect => effect.type === "send" && effect.visible)).toBe(false);
    const reserved = transitionThreadPresence(next.state, { type: "reserved", revision: 2, activityId: 18 });
    expect(reserved.state).toEqual({ phase: "visible", revision: 2, lease: { ...lease, bearer: "new-session", activityId: 18 } });
  });
  it.each([null, 0, -1, Number.MAX_SAFE_INTEGER + 1, 1.5])("fails closed for a refused or invalid reservation %s", activityId => {
    expect(transitionThreadPresence(states[2]!, { type: "reserved", revision: 1, activityId }).state.phase).toBe("idle");
  });
  it("makes pending credentials and reservations inert on hide and departure", () => {
    for (const state of states.slice(1, 3)) {
      for (const type of ["hide", "stop", "ownership-lost"] as const) {
        const result = transitionThreadPresence(state, { type });
        expect(result.effects.some(effect => effect.type === "send")).toBe(false);
        expect(transitionThreadPresence(result.state, { type: "reserved", revision: 1, activityId: 20 }).state).toBe(result.state);
        expect(transitionThreadPresence(result.state, { type: "credentials", revision: 1, binding }).state).toBe(result.state);
      }
    }
  });
});
