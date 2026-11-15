import { loadOutingStepsBridge, type OutingStepsBridge, type OutingStepsStatus } from "@/lib/nativeOutingSteps";
import {
  isOutingStepsSession,
  OUTING_STEPS_STORAGE_KEY,
  outingStepsWindow,
  parseOutingSteps,
  serializeOutingSteps,
  type OutingStepsEvent,
  type OutingStepsState,
} from "@/lib/outingSteps";

type Refused = { kind: "refused"; status: OutingStepsStatus };
type Stale = { kind: "stale" };
type Failed = { kind: "failed" };

export type OutingStepsBegin = { kind: "started"; event: Extract<OutingStepsEvent, { type: "start" }> } | Refused | Stale | Failed;
export type OutingStepsRead = { kind: "event"; event: OutingStepsEvent } | { kind: "none" } | Refused | Stale | Failed;

type Scope = { signal: AbortSignal; now: () => number };

function mintOutingStepsSession(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

const OFF: OutingStepsState = { phase: "off" };
const STALE: Stale = { kind: "stale" };
const FAILED: Failed = { kind: "failed" };

function localStore(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

const errorCode = (error: unknown) => (error as { code?: unknown } | null)?.code;

export function readOutingSteps(owner: string | null): OutingStepsState {
  try {
    return parseOutingSteps(localStore()?.getItem(OUTING_STEPS_STORAGE_KEY) ?? null, owner);
  } catch {
    return OFF;
  }
}

export function writeOutingSteps(state: OutingStepsState): void {
  try {
    const raw = serializeOutingSteps(state);
    if (raw) localStore()?.setItem(OUTING_STEPS_STORAGE_KEY, raw);
    else localStore()?.removeItem(OUTING_STEPS_STORAGE_KEY);
  } catch { /* Storage can be full or blocked. The count still shows until the page closes. */ }
}

function countingSession(): string | null {
  try {
    const row = JSON.parse(localStore()?.getItem(OUTING_STEPS_STORAGE_KEY) ?? "null") as { phase?: unknown; session?: unknown } | null;
    return row?.phase === "counting" && isOutingStepsSession(row.session) ? row.session : null;
  } catch {
    return null;
  }
}

export function forgetOutingSteps(): void {
  const session = countingSession();
  try { localStore()?.removeItem(OUTING_STEPS_STORAGE_KEY); } catch {}
  if (session !== null) void loadOutingStepsBridge().then((bridge) => bridge?.stop({ session })).catch(() => {});
}

async function refusal(bridge: OutingStepsBridge, error: unknown): Promise<Refused | Failed> {
  if (errorCode(error) !== "denied" && errorCode(error) !== "unavailable") return FAILED;
  const status = await bridge.status().catch(() => null);
  return status ? { kind: "refused", status } : FAILED;
}

export async function beginOutingSteps(
  bridge: OutingStepsBridge,
  { planId, owner, signal, now, mintSession = mintOutingStepsSession }: Scope & { planId: string; owner: string | null; mintSession?: () => string },
): Promise<OutingStepsBegin> {
  try {
    let status = await bridge.status();
    if (signal.aborted) return STALE;
    if (status.available && status.permission === "prompt") status = await bridge.requestPermission();
    if (signal.aborted) return STALE;
    if (!status.available || status.permission !== "granted") return { kind: "refused", status };
    const at = now();
    const session = mintSession();
    const sample = await bridge.sample({ since: at, until: at, session });
    if (signal.aborted) {
      void bridge.stop({ session });
      return STALE;
    }
    return sample ? { kind: "started", event: { type: "start", planId, owner, session, at, sample } } : FAILED;
  } catch (error) {
    return signal.aborted ? STALE : refusal(bridge, error);
  }
}

export async function readOutingStepsEvent(bridge: OutingStepsBridge, state: OutingStepsState, { signal, now }: Scope): Promise<OutingStepsRead> {
  const window = outingStepsWindow(state, now());
  if (!window || state.phase !== "counting") return { kind: "none" };
  try {
    const sample = await bridge.sample(window);
    if (signal.aborted) {
      void bridge.stop({ session: state.session });
      return STALE;
    }
    return sample ? { kind: "event", event: { type: "sample", session: state.session, at: now(), sample } } : { kind: "none" };
  } catch (error) {
    if (signal.aborted) return STALE;
    if (errorCode(error) === "expired" || errorCode(error) === "history_expired") {
      return { kind: "event", event: { type: "incomplete", session: state.session, at: now() } };
    }
    return refusal(bridge, error);
  }
}
