import { describe, expect, it } from "vitest";
import { createIdleOrbit } from "@/lib/mapOrbit";

const FIRST_MS = 6_000;
const INTERACTION_MS = 20_000;

function harness({ reduced = false }: { reduced?: boolean } = {}) {
  let nextId = 1;
  const timers = new Map<number, { callback: () => void; ms: number }>();
  const calls: string[] = [];
  const armedDelays: number[] = [];
  let isReduced = reduced;

  const orbit = createIdleOrbit({
    firstDelayMs: FIRST_MS,
    interactionDelayMs: INTERACTION_MS,
    isReduced: () => isReduced,
    startChunk: () => calls.push("start"),
    stopChunk: () => calls.push("stop"),
    setTimer: (callback, ms) => {
      const id = nextId++;
      timers.set(id, { callback, ms });
      armedDelays.push(ms);
      return id;
    },
    clearTimer: (id) => timers.delete(id),
  });

  return {
    orbit,
    calls,
    timers,
    armedDelays,
    setReduced(value: boolean) {
      isReduced = value;
    },
    fireTimer() {
      const entry = timers.entries().next().value as [number, { callback: () => void }] | undefined;
      if (!entry) throw new Error("no timer armed");
      timers.delete(entry[0]);
      entry[1].callback();
    },
  };
}

describe("idle orbit state machine", () => {
  it("waits out the idle delay after enable, then orbits chunk after chunk", () => {
    const h = harness();
    h.orbit.setEnabled(true);
    expect(h.orbit.state()).toBe("waiting");
    expect(h.timers.size).toBe(1);

    h.fireTimer();
    expect(h.orbit.state()).toBe("orbiting");
    expect(h.calls).toEqual(["start"]);

    h.orbit.noteChunkEnd();
    h.orbit.noteChunkEnd();
    expect(h.calls).toEqual(["start", "start", "start"]);
  });

  it("pauses instantly on interaction and re-arms the idle timer", () => {
    const h = harness();
    h.orbit.setEnabled(true);
    h.fireTimer();
    expect(h.orbit.state()).toBe("orbiting");

    h.orbit.noteInteraction();
    expect(h.calls).toEqual(["start", "stop"]);
    expect(h.orbit.state()).toBe("waiting");

    // A stray chunk-end from the interrupted animation must not restart it.
    h.orbit.noteChunkEnd();
    expect(h.calls).toEqual(["start", "stop"]);
  });

  it("interaction while merely waiting resets the timer without a stop call", () => {
    const h = harness();
    h.orbit.setEnabled(true);
    const before = h.timers.size;
    h.orbit.noteInteraction();
    expect(h.timers.size).toBe(before);
    expect(h.calls).toEqual([]);
  });

  it("never orbits for reduced-motion users, including a mid-session toggle", () => {
    const reduced = harness({ reduced: true });
    reduced.orbit.setEnabled(true);
    expect(reduced.orbit.state()).toBe("off");
    expect(reduced.timers.size).toBe(0);

    const live = harness();
    live.orbit.setEnabled(true);
    live.fireTimer();
    expect(live.orbit.state()).toBe("orbiting");
    live.setReduced(true);
    live.orbit.noteChunkEnd();
    expect(live.orbit.state()).toBe("off");
    expect(live.calls).toEqual(["start", "stop"]);
  });

  it("suspend (hidden tab / off-screen canvas) stops everything; resume re-arms", () => {
    const h = harness();
    h.orbit.setEnabled(true);
    h.fireTimer();
    h.orbit.setSuspended(true);
    expect(h.calls).toEqual(["start", "stop"]);
    expect(h.orbit.state()).toBe("suspended");
    expect(h.timers.size).toBe(0);

    h.orbit.setSuspended(false);
    expect(h.orbit.state()).toBe("waiting");
  });

  it("first arm waits only the first-impression delay", () => {
    const h = harness();
    h.orbit.setEnabled(true);
    expect(h.armedDelays).toEqual([FIRST_MS]);
  });

  it("after any interaction every re-arm waits the generous interaction delay", () => {
    const h = harness();
    h.orbit.setEnabled(true);
    h.fireTimer(); // first orbit began after FIRST_MS
    h.orbit.noteInteraction();
    expect(h.armedDelays).toEqual([FIRST_MS, INTERACTION_MS]);

    // Sticky across suspend/resume once interacted.
    h.orbit.setSuspended(true);
    h.orbit.setSuspended(false);
    expect(h.armedDelays).toEqual([FIRST_MS, INTERACTION_MS, INTERACTION_MS]);
  });

  it("suspend/resume BEFORE any interaction still re-arms with the first delay", () => {
    // The live-verification path: tab hidden then visible again while the user
    // has never touched the map (visibilitychange -> setSuspended(false) must
    // re-arm, and with the short delay).
    const h = harness();
    h.orbit.setEnabled(true);
    h.orbit.setSuspended(true);
    expect(h.timers.size).toBe(0);
    h.orbit.setSuspended(false);
    expect(h.orbit.state()).toBe("waiting");
    expect(h.armedDelays).toEqual([FIRST_MS, FIRST_MS]);
  });

  it("disable tears down and dispose is terminal", () => {
    const h = harness();
    h.orbit.setEnabled(true);
    h.fireTimer();
    h.orbit.setEnabled(false);
    expect(h.calls).toEqual(["start", "stop"]);
    expect(h.orbit.state()).toBe("off");

    h.orbit.dispose();
    h.orbit.setEnabled(true);
    expect(h.timers.size).toBe(0);
  });
});
