import { loadOutingStepsBridge, type OutingStepsBridge, type OutingStepsStatus } from "@/lib/nativeOutingSteps";
import {
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

function someoneCounting(): boolean {
  try {
    const raw = localStore()?.getItem(OUTING_STEPS_STORAGE_KEY);
    return Boolean(raw) && (JSON.parse(raw as string) as { phase?: unknown } | null)?.phase === "counting";
  } catch {
    return false;
  }
}

export function forgetOutingSteps(): void {
  try { localStore()?.removeItem(OUTING_STEPS_STORAGE_KEY); } catch {}
  void loadOutingStepsBridge().then((bridge) => bridge?.stop()).catch(() => {});
}

async function refusal(bridge: OutingStepsBridge, error: unknown): Promise<Refused | Failed> {
  if (errorCode(error) !== "denied" && errorCode(error) !== "unavailable") return FAILED;
  const status = await bridge.status().catch(() => null);
  return status ? { kind: "refused", status } : FAILED;
}

export async function beginOutingSteps(
  bridge: OutingStepsBridge,
  { planId, owner, signal, now }: Scope & { planId: string; owner: string | null },
): Promise<OutingStepsBegin> {
  try {
    let status = await bridge.status();
    if (signal.aborted) return STALE;
    if (status.available && status.permission === "prompt") status = await bridge.requestPermission();
    if (signal.aborted) return STALE;
    if (!status.available || status.permission !== "granted") return { kind: "refused", status };
    const at = now();
    const sample = await bridge.sample({ since: at, until: at });
    if (signal.aborted) {
      if (!someoneCounting()) void bridge.stop();
      return STALE;
    }
    return sample ? { kind: "started", event: { type: "start", planId, owner, at, sample } } : FAILED;
  } catch (error) {
    return signal.aborted ? STALE : refusal(bridge, error);
  }
}

export async function readOutingStepsEvent(bridge: OutingStepsBridge, state: OutingStepsState, { signal, now }: Scope): Promise<OutingStepsRead> {
  const window = outingStepsWindow(state, now());
  if (!window || state.phase !== "counting") return { kind: "none" };
  try {
    const sample = await bridge.sample(window);
    if (signal.aborted) return STALE;
    return sample ? { kind: "event", event: { type: "sample", startedAt: state.startedAt, at: now(), sample } } : { kind: "none" };
  } catch (error) {
    if (signal.aborted) return STALE;
    if (errorCode(error) === "expired") return { kind: "event", event: { type: "stop", startedAt: state.startedAt, at: now() } };
    return refusal(bridge, error);
  }
}
