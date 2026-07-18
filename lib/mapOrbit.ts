// Idle auto-orbit for the pub map: a slow, cinematic bearing drift that starts
// after a generous idle delay and yields INSTANTLY to any user or programmatic
// camera activity. Owner call 2026-07-19: the ambient orbit returns,
// superseding its removal in abeb471e. That removal had three stated reasons;
// each is addressed structurally rather than avoided:
//
//   1. "Per-frame camera motion caused tile churn that read as flicker" — the
//      old orbit drove the camera from JS every frame. This one issues ONE
//      MapLibre rotateTo animation per long chunk (12s, linear easing); the
//      browser/GPU interpolates internally, JS runs once per chunk, and at
//      0.6 deg/s edge-tile loads are rare and prefetched.
//   2. "Fought spatial memory" — the drift is slow enough to read as ambience
//      (full turn in 10 minutes), pauses the moment the user touches anything,
//      and resumes only after 20s of stillness.
//   3. "Starved the pin-reveal idle event" — the orbit is enabled only AFTER
//      the reveal has fired (the canvas gates enable() on mapReady), so boot
//      idle frames are never consumed by camera motion.
//
// This module is the pure state machine (injected timers, no clocks of its
// own) so every transition is hermetically testable. The canvas supplies the
// actual MapLibre calls.

export type OrbitState = "off" | "waiting" | "orbiting" | "suspended";

type OrbitOptions = {
  idleDelayMs: number;
  // Live gate, read at every decision point so an OS-level toggle mid-session
  // takes effect without re-wiring: reduced users never orbit.
  isReduced: () => boolean;
  // Begin one rotation chunk (a single long rotateTo). Called again on each
  // chunk end while still orbiting.
  startChunk: () => void;
  // Interrupt any active chunk immediately (map.stop()).
  stopChunk: () => void;
  setTimer: (callback: () => void, ms: number) => number;
  clearTimer: (id: number) => void;
};

export type IdleOrbit = {
  /** The canvas flips this once the pin reveal has fired (and off on teardown). */
  setEnabled: (enabled: boolean) => void;
  /** Any user gesture or programmatic camera intent: instant pause + fresh idle timer. */
  noteInteraction: () => void;
  /** A rotation chunk finished; continue if still orbiting. */
  noteChunkEnd: () => void;
  /** Tab hidden / canvas scrolled off-screen: hard suspend (no timer runs). */
  setSuspended: (suspended: boolean) => void;
  state: () => OrbitState;
  dispose: () => void;
};

export function createIdleOrbit({
  idleDelayMs,
  isReduced,
  startChunk,
  stopChunk,
  setTimer,
  clearTimer,
}: OrbitOptions): IdleOrbit {
  let enabled = false;
  let suspended = false;
  let orbiting = false;
  let timer: number | null = null;
  let disposed = false;

  const clearIdleTimer = () => {
    if (timer !== null) clearTimer(timer);
    timer = null;
  };

  const stopOrbiting = () => {
    if (!orbiting) return;
    orbiting = false;
    stopChunk();
  };

  const armTimer = () => {
    clearIdleTimer();
    if (disposed || !enabled || suspended || isReduced()) return;
    timer = setTimer(() => {
      timer = null;
      if (disposed || !enabled || suspended || isReduced()) return;
      orbiting = true;
      startChunk();
    }, idleDelayMs);
  };

  return {
    setEnabled(next) {
      if (enabled === next) return;
      enabled = next;
      if (!enabled) {
        stopOrbiting();
        clearIdleTimer();
        return;
      }
      armTimer();
    },
    noteInteraction() {
      stopOrbiting();
      armTimer();
    },
    noteChunkEnd() {
      if (disposed || !orbiting) return;
      if (!enabled || suspended || isReduced()) {
        stopOrbiting();
        return;
      }
      startChunk();
    },
    setSuspended(next) {
      if (suspended === next) return;
      suspended = next;
      if (suspended) {
        stopOrbiting();
        clearIdleTimer();
        return;
      }
      armTimer();
    },
    state() {
      if (orbiting) return "orbiting";
      if (timer !== null) return "waiting";
      return suspended ? "suspended" : "off";
    },
    dispose() {
      disposed = true;
      stopOrbiting();
      clearIdleTimer();
    },
  };
}

/** Slow hero drift: full revolution in 10 minutes. */
export const ORBIT_DEG_PER_SEC = 0.6;
/** One MapLibre animation per chunk; JS wakes ~5 times a minute, not per frame. */
export const ORBIT_CHUNK_MS = 12_000;
/** Generous stillness before the ambience returns. */
export const ORBIT_IDLE_DELAY_MS = 20_000;
