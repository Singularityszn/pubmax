// Measured steps for one night out, read from the phone's own step sensor.
// Estimated walking steps for a route are a different figure and live elsewhere.
// The session stays on this device: no server, account, plan write or analytics.

export const OUTING_STEPS_MAX_MS = 12 * 60 * 60 * 1000;
export const OUTING_STEPS_STORAGE_KEY = "pubmax:outing-steps:v1";

/**
 * iOS asks Core Motion for the total between two times, so a reading survives
 * suspension, termination and reboot. Android reads a counter that resets at boot
 * and may not advance while the app is not running.
 */
export type OutingStepsSample =
  | { platform: "ios"; steps: number }
  | { platform: "android"; counter: number | null; bootCount: number; continuous: boolean };

type AndroidCounter = { bootCount: number; baseline: number | null; carried: number; last: number | null };

export type OutingStepsState =
  | { phase: "off" }
  | { phase: "counting"; planId: string; owner: string | null; startedAt: number; steps: number; gap: boolean; counter: AndroidCounter | null }
  | { phase: "stopped"; planId: string; owner: string | null; startedAt: number; endedAt: number; steps: number; gap: boolean };

export type OutingStepsEvent =
  | { type: "start"; planId: string; owner: string | null; at: number; sample: OutingStepsSample }
  | { type: "sample"; startedAt: number; at: number; sample: OutingStepsSample }
  | { type: "stop"; startedAt: number; at: number }
  | { type: "clear" };

type Counting = Extract<OutingStepsState, { phase: "counting" }>;

const OFF: OutingStepsState = { phase: "off" };
const isCount = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const isTime = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value > 0;

function finish(state: Counting, endedAt: number, steps: number, gap: boolean): OutingStepsState {
  return { phase: "stopped", planId: state.planId, owner: state.owner, startedAt: state.startedAt, endedAt, steps, gap };
}

function sameCounting(a: Counting, b: Counting): boolean {
  return a.steps === b.steps && a.gap === b.gap && a.counter?.bootCount === b.counter?.bootCount
    && a.counter?.baseline === b.counter?.baseline && a.counter?.carried === b.counter?.carried && a.counter?.last === b.counter?.last;
}

const knownBoot = (bootCount: number) => bootCount >= 0;

function readAndroid(state: Counting, counter: AndroidCounter, sample: Extract<OutingStepsSample, { platform: "android" }>): Counting {
  const gap = state.gap || !sample.continuous;
  if (sample.counter === null) return { ...state, gap };
  const bootCount = knownBoot(sample.bootCount) ? sample.bootCount : counter.bootCount;
  if (counter.baseline === null || counter.last === null) {
    return { ...state, gap, counter: { ...counter, bootCount, baseline: sample.counter, last: sample.counter } };
  }
  const rebooted = knownBoot(sample.bootCount) && knownBoot(counter.bootCount) && sample.bootCount !== counter.bootCount;
  if (sample.counter >= counter.last && !rebooted) {
    return { ...state, gap, counter: { ...counter, bootCount, last: sample.counter }, steps: counter.carried + sample.counter - counter.baseline };
  }
  // The counter restarts at zero on boot. Steps between the last reading and the reboot are lost.
  const restarted = rebooted && sample.counter < counter.last;
  const next = { bootCount, baseline: restarted ? 0 : sample.counter, carried: state.steps, last: sample.counter };
  return { ...state, gap: true, counter: next, steps: next.carried + sample.counter - next.baseline };
}

function readSample(state: Counting, at: number, sample: OutingStepsSample): OutingStepsState {
  const cap = state.startedAt + OUTING_STEPS_MAX_MS;
  if (sample.platform === "ios") {
    if (state.counter !== null || !isCount(sample.steps)) return state;
    const steps = Math.max(state.steps, sample.steps);
    if (at > cap) return finish(state, cap, steps, state.gap);
    return steps === state.steps ? state : { ...state, steps };
  }
  if (state.counter === null || (sample.counter !== null && !isCount(sample.counter)) || !Number.isSafeInteger(sample.bootCount)) return state;
  // An Android reading after the cap cannot be split at the cap, so the last count before it stands.
  if (at > cap) return finish(state, cap, state.steps, true);
  const next = readAndroid(state, state.counter, sample);
  return sameCounting(state, next) ? state : next;
}

export function transitionOutingSteps(state: OutingStepsState, event: OutingStepsEvent): OutingStepsState {
  switch (event.type) {
    case "start": {
      if (state.phase === "counting") return state;
      const counter = event.sample.platform === "android"
        ? { bootCount: event.sample.bootCount, baseline: isCount(event.sample.counter) ? event.sample.counter : null, carried: 0, last: isCount(event.sample.counter) ? event.sample.counter : null }
        : null;
      return { phase: "counting", planId: event.planId, owner: event.owner, startedAt: event.at, steps: 0, gap: false, counter };
    }
    case "sample":
      return state.phase === "counting" && state.startedAt === event.startedAt ? readSample(state, event.at, event.sample) : state;
    case "stop":
      if (state.phase !== "counting" || state.startedAt !== event.startedAt) return state;
      return finish(state, Math.min(event.at, state.startedAt + OUTING_STEPS_MAX_MS), state.steps, state.gap);
    case "clear":
      return state.phase === "off" ? state : OFF;
    default: {
      const unreachable: never = event;
      return unreachable;
    }
  }
}

/** The span iOS should total. Null when nothing is counting. */
export function outingStepsWindow(state: OutingStepsState, now: number): { since: number; until: number } | null {
  if (state.phase !== "counting") return null;
  return { since: state.startedAt, until: Math.max(state.startedAt, Math.min(now, state.startedAt + OUTING_STEPS_MAX_MS)) };
}

export function serializeOutingSteps(state: OutingStepsState): string | null {
  return state.phase === "off" ? null : JSON.stringify({ v: 1, ...state });
}

function parseCounter(value: unknown): AndroidCounter | null | undefined {
  if (value === null) return null;
  if (!value || typeof value !== "object") return undefined;
  const { bootCount, baseline, carried, last } = value as Record<string, unknown>;
  if (!Number.isSafeInteger(bootCount) || !(baseline === null || isCount(baseline)) || !isCount(carried) || !(last === null || isCount(last))) return undefined;
  return { bootCount: bootCount as number, baseline, carried, last };
}

export function parseOutingSteps(raw: string | null, owner: string | null): OutingStepsState {
  if (!raw) return OFF;
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return OFF; }
  if (!value || typeof value !== "object" || Array.isArray(value)) return OFF;
  const row = value as Record<string, unknown>;
  const { planId, startedAt, steps, gap } = row;
  if (row.v !== 1 || row.owner !== owner || typeof planId !== "string" || !planId || !isTime(startedAt) || !isCount(steps) || typeof gap !== "boolean") return OFF;
  if (row.phase === "stopped") {
    return isTime(row.endedAt) && row.endedAt >= startedAt ? { phase: "stopped", planId, owner, startedAt, endedAt: row.endedAt, steps, gap } : OFF;
  }
  if (row.phase !== "counting") return OFF;
  const counter = parseCounter(row.counter);
  return counter === undefined ? OFF : { phase: "counting", planId, owner, startedAt, steps, gap, counter };
}
