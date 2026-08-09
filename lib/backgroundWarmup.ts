"use client";

// Background warmup buys the NEXT tap, so it must never be spent on the paint
// the reader is waiting for.
//
// "Browser idle" alone is not that promise. A cold /map open goes idle at
// roughly one second — after the skeleton paints and before the router has even
// requested the map's own chunks — so an idle-scheduled tab prefetch downloads
// and parses the other tabs' JS in the middle of MapLibre's init, which is the
// most main-thread-bound stretch of the whole session.
//
// So a foreground surface that owns a long first paint takes a HOLD and
// releases it once it has painted; background warmup waits for the last hold,
// then still waits for idle. The ceiling is the honest limit: a surface that
// never finishes painting must not starve warmup forever, so a hold expires on
// its own and warmup proceeds.

/** A surface that never paints must not hold warmup for the whole session. */
export const BACKGROUND_WARMUP_HOLD_CEILING_MS = 12_000;

type Timers = {
  setTimeout: (callback: () => void, ms: number) => number;
  clearTimeout: (handle: number) => void;
  requestIdle?: (callback: () => void, timeoutMs: number) => number;
  cancelIdle?: (handle: number) => void;
};

let holds = 0;
let waiting: (() => void)[] = [];

function browserTimers(): Timers {
  if (typeof window === "undefined") {
    return {
      setTimeout: (callback) => {
        callback();
        return 0;
      },
      clearTimeout: () => {},
    };
  }
  return {
    setTimeout: (callback, ms) => window.setTimeout(callback, ms),
    clearTimeout: (handle) => window.clearTimeout(handle),
    requestIdle:
      typeof window.requestIdleCallback === "function"
        ? (callback, timeoutMs) => window.requestIdleCallback(callback, { timeout: timeoutMs })
        : undefined,
    cancelIdle:
      typeof window.cancelIdleCallback === "function"
        ? (handle) => window.cancelIdleCallback(handle)
        : undefined,
  };
}

function drain(): void {
  if (holds > 0) return;
  const pending = waiting;
  waiting = [];
  for (const run of pending) run();
}

/**
 * Hold background warmup while this surface paints. Returns the release, which
 * is idempotent so a React effect cleanup and an explicit release cannot
 * double-count. The hold also expires on its own after the ceiling.
 */
export function holdBackgroundWarmup(
  ceilingMs: number = BACKGROUND_WARMUP_HOLD_CEILING_MS,
  timers: Timers = browserTimers(),
): () => void {
  holds += 1;
  let released = false;
  const expiry = timers.setTimeout(() => release(), ceilingMs);
  function release(): void {
    if (released) return;
    released = true;
    timers.clearTimeout(expiry);
    holds = Math.max(0, holds - 1);
    drain();
  }
  return release;
}

/**
 * Run background work once no surface is holding warmup AND the browser is
 * idle. Returns a cancel for React effect cleanup.
 */
export function whenBackgroundWarmupAllowed(
  run: () => void,
  idleTimeoutMs = 5_000,
  timers: Timers = browserTimers(),
): () => void {
  let cancelled = false;
  let idleHandle: number | null = null;
  let timeoutHandle: number | null = null;

  const schedule = () => {
    if (cancelled) return;
    if (timers.requestIdle) {
      idleHandle = timers.requestIdle(() => {
        if (!cancelled) run();
      }, idleTimeoutMs);
      return;
    }
    timeoutHandle = timers.setTimeout(() => {
      if (!cancelled) run();
    }, idleTimeoutMs);
  };

  if (holds > 0) {
    waiting.push(schedule);
  } else {
    schedule();
  }

  return () => {
    cancelled = true;
    if (idleHandle !== null) timers.cancelIdle?.(idleHandle);
    if (timeoutHandle !== null) timers.clearTimeout(timeoutHandle);
    waiting = waiting.filter((entry) => entry !== schedule);
  };
}

/** Test seam only: drop every hold and queued waiter. */
export function resetBackgroundWarmupForTests(): void {
  holds = 0;
  waiting = [];
}

/** Test seam only: how many surfaces are currently holding. */
export function backgroundWarmupHoldCount(): number {
  return holds;
}
