import { describe, expect, it } from "vitest";
import { INITIAL_THREAD_PRESENCE, transitionThreadPresence, type ThreadPresenceState, type ThreadPresenceEvent } from "@/lib/messageThreadPresenceState";

const binding = { token: "device", bearer: "session", sessionId: "session-id" };
const lease = { ...binding, activityId: 17 };
const states: ThreadPresenceState[] = [
  INITIAL_THREAD_PRESENCE,
  { phase: "loading", revision: 1, reuse: false },
  { phase: "reserving", revision: 1, binding },
  { phase: "visible", revision: 1, lease },
  { phase: "hidden", revision: 2, lease },
  { phase: "stopped", revision: 3, lease },
  { phase: "paused", revision: 4, lease, departureRevision: 2 },
];

describe("asynchronous thread presence transitions", () => {
  it.each([0, 3, 4])("starts a bounded credential attempt from state %s", index => {
    const state = states[index]!;
    const next = transitionThreadPresence(state, { type: "refresh" });
    expect(next.state.phase).toBe("loading");
    expect(next.effects).toEqual([{ type: "credentials", revision: state.revision + 1 }]);
  });
  it.each([0, 1, 2, 3, 4, 6])("fences each live phase on hide, departure, unmount and ownership loss: %s", index => {
    const state = states[index]!;
    for (const event of [{ type: "hide" }, { type: "depart", departureRevision: 3 }, { type: "stop" }, { type: "ownership-lost" }] satisfies ThreadPresenceEvent[]) {
      const next = transitionThreadPresence(state, event);
      if ((state.phase === "hidden" || state.phase === "paused") && event.type === "hide") {
        expect(next.state).toBe(state);
        continue;
      }
      expect(next.state.revision).toBe(state.revision + 1);
      expect(next.effects).toContainEqual({ type: "abort" });
      const clears = next.effects.filter(effect => effect.type === "send");
      expect(clears).toEqual(state.lease && event.type !== "ownership-lost" ? [{ type: "send", revision: state.revision + 1, lease, visible: false }] : []);
    }
  });
  it.each([1, 2, 3])("recovers an expired active stage and fences its late completion: %s", index => {
    const state = states[index]!;
    const failed = transitionThreadPresence(state, { type: "failed", revision: state.revision });
    expect(failed.state.phase).toBe("idle");
    expect(failed.state.revision).toBe(state.revision + 1);
    expect(failed.effects).toEqual([{ type: "abort" }]);
    expect(transitionThreadPresence(failed.state, { type: "reserved", revision: state.revision, activityId: 99 }).state).toBe(failed.state);
    expect(transitionThreadPresence(failed.state, { type: "refresh" }).effects[0]?.type).toBe("credentials");
  });
  it("accepts null credentials without sending or closing a notice", () => {
    const next = transitionThreadPresence(states[1]!, { type: "credentials", revision: 1, binding: null });
    expect(next.state.phase).toBe("idle");
    expect(next.effects).toEqual([]);
  });
  it("uses the same lease with a refreshed bearer for one ordinary heartbeat", () => {
    const loading = transitionThreadPresence(states[3]!, { type: "refresh" }).state;
    const next = transitionThreadPresence(loading, { type: "credentials", revision: 2, binding: { ...binding, bearer: "refreshed" } });
    expect(next.state).toEqual({ phase: "visible", revision: 2, lease: { ...lease, bearer: "refreshed" } });
    expect(next.effects).toEqual([{ type: "send", revision: 2, lease: { ...lease, bearer: "refreshed" }, visible: true }]);
  });
  it("clears the old binding and reserves for another device or session", () => {
    for (const nextBinding of [{ ...binding, token: "other-device" }, { ...binding, sessionId: "other-session" }]) {
      const loading = transitionThreadPresence(states[3]!, { type: "refresh" }).state;
      const next = transitionThreadPresence(loading, { type: "credentials", revision: 2, binding: nextBinding });
      expect(next.state.phase).toBe("reserving");
      expect(next.effects).toEqual([{ type: "send", revision: 2, lease, visible: false }, { type: "reserve", revision: 2, binding: nextBinding }]);
    }
  });
  it("reads and closes the tray only after an applied current write", () => {
    const next = transitionThreadPresence(states[3]!, { type: "delivered", revision: 1, applied: true });
    expect(next.effects).toEqual([{ type: "notifications", revision: 1 }]);
    expect(transitionThreadPresence(next.state, { type: "notifications-loaded", revision: 1 }).effects).toEqual([{ type: "close-notifications" }]);
    const refused = transitionThreadPresence(states[3]!, { type: "delivered", revision: 1, applied: false });
    expect(refused.state.phase).toBe("idle");
    expect(refused.effects).toEqual([{ type: "abort" }]);
  });
  it("resumes only the confirmed departed binding and never an unmounted lifetime", () => {
    const paused = states[6]!;
    for (const event of [{ type: "refresh" }, { type: "hide" }, { type: "restored", departureRevision: 1, ...binding }, { type: "restored", departureRevision: 2, ...binding, token: "other" }, { type: "restored", departureRevision: 2, ...binding, sessionId: "other" }] satisfies ThreadPresenceEvent[]) {
      expect(transitionThreadPresence(paused, event).state).toBe(paused);
    }
    const restored: ThreadPresenceEvent = { type: "restored", departureRevision: 2, token: binding.token, sessionId: binding.sessionId };
    const next = transitionThreadPresence(paused, restored);
    expect(next.state).toEqual({ phase: "hidden", revision: 5 });
    expect(transitionThreadPresence(next.state, { type: "refresh" }).effects).toEqual([{ type: "credentials", revision: 6 }]);
    expect(transitionThreadPresence(states[5]!, restored).state).toBe(states[5]);
  });
  it.each(states)("refuses stale async completions without allocation in $phase", state => {
    for (const event of [
      { type: "credentials", revision: 99, binding },
      { type: "reserved", revision: 99, activityId: 18 },
      { type: "failed", revision: 99 },
      { type: "delivered", revision: 99, applied: true },
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
  it("requires a new reservation when the authenticated session changes", () => {
    const loading = transitionThreadPresence(states[3]!, { type: "refresh" }).state;
    const next = transitionThreadPresence(loading, { type: "credentials", revision: 2, binding: { ...binding, bearer: "new-session", sessionId: "other-session" } });
    expect(next.state.phase).toBe("reserving");
    expect(next.effects.some(effect => effect.type === "send" && effect.visible)).toBe(false);
    const reserved = transitionThreadPresence(next.state, { type: "reserved", revision: 2, activityId: 18 });
    expect(reserved.state).toEqual({ phase: "visible", revision: 2, lease: { ...lease, bearer: "new-session", sessionId: "other-session", activityId: 18 } });
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
