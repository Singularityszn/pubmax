import { describe, expect, it } from "vitest";

import {
  transitionIdleTabWarm,
  type IdleTabWarmEvent,
  type IdleTabWarmState,
} from "@/lib/idleTabWarm";

const OFF: IdleTabWarmState = { phase: "off" };

function run(events: IdleTabWarmEvent[], from: IdleTabWarmState = OFF): IdleTabWarmState {
  return events.reduce(transitionIdleTabWarm, from);
}

const start: IdleTabWarmEvent = { type: "start", allowed: true, loaded: false };
const idle: IdleTabWarmEvent = { type: "idle", allowed: true, visible: true };

describe("the dock's idle tab warm", () => {
  it("waits for the load, then the quiet delay, then an idle moment, and only then warms", () => {
    expect(run([start])).toEqual({ phase: "awaiting_load" });
    expect(run([start, { type: "loaded" }])).toEqual({ phase: "awaiting_delay" });
    expect(run([start, { type: "loaded" }, { type: "delay_elapsed" }])).toEqual({ phase: "awaiting_idle" });
    expect(run([start, { type: "loaded" }, { type: "delay_elapsed" }, idle])).toEqual({ phase: "warmed" });
  });

  it("skips the wait for a load that has already happened", () => {
    expect(run([{ type: "start", allowed: true, loaded: true }])).toEqual({ phase: "awaiting_delay" });
  });

  it("never starts for a reader who asked for less data", () => {
    expect(run([{ type: "start", allowed: false, loaded: true }])).toEqual(OFF);
    expect(run([{ type: "start", allowed: false, loaded: true }, { type: "loaded" }, { type: "delay_elapsed" }, idle])).toEqual(OFF);
  });

  it("does not warm when the connection or the tab changed during the wait", () => {
    const waiting = run([start, { type: "loaded" }, { type: "delay_elapsed" }]);
    expect(transitionIdleTabWarm(waiting, { type: "idle", allowed: false, visible: true })).toEqual(OFF);
    expect(transitionIdleTabWarm(waiting, { type: "idle", allowed: true, visible: false })).toEqual(OFF);
  });

  it("stops at any stage, and a late callback cannot bring it back", () => {
    for (const events of [[start], [start, { type: "loaded" } as const], [start, { type: "loaded" } as const, { type: "delay_elapsed" } as const]]) {
      const stopped = transitionIdleTabWarm(run(events), { type: "cancel" });
      expect(stopped).toEqual(OFF);
      expect(run([{ type: "loaded" }, { type: "delay_elapsed" }, idle], stopped)).toEqual(OFF);
    }
  });

  it("ignores a callback that belongs to another stage, and returns the same state for it", () => {
    const waitingForLoad = run([start]);
    expect(transitionIdleTabWarm(waitingForLoad, { type: "delay_elapsed" })).toBe(waitingForLoad);
    expect(transitionIdleTabWarm(waitingForLoad, idle)).toBe(waitingForLoad);

    const warmed = run([start, { type: "loaded" }, { type: "delay_elapsed" }, idle]);
    expect(transitionIdleTabWarm(warmed, start)).toBe(warmed);
    expect(transitionIdleTabWarm(warmed, idle)).toBe(warmed);
  });
});
