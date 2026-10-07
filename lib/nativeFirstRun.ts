// Native first launches open onboarding. Interrupted journeys resume until
// the reader taps Skip or Plan my night. Completed journeys open Tonight.
// An existing city choice bypasses onboarding unless a journey is unfinished.
//
// Storage mirrors the lib/firstRunTour.ts idiom: localStorage-backed,
// SSR-safe, no-op when storage is unavailable. Never routes on the web — the
// isNative flag threaded through shouldRouteNativeFirstRun is sourced from
// isNativeApp() (lib/nativePlatform.ts), the only Capacitor-detection seam.

import { hasSeenTour } from "@/lib/firstRunTour";
import { isNativeApp } from "@/lib/nativePlatform";
import { safeLocalStorage, safeSessionStorage } from "@/lib/safeStorage";
import type { OnboardingStep } from "@/lib/onboardingFlow";

/**
 * The device mark that says onboarding was explicitly finished or skipped.
 * Exported because the entry block in public/theme-init.js reads it before
 * React exists,
 * to tell a first launch from every later one.
 */
export const NATIVE_FIRST_RUN_DONE_KEY = "pubmax:nativeFirstRun:done:v2";
/**
 * Earlier releases wrote this mark when routing STARTED, so alone it proves only
 * that a journey began. Those releases also wrote the tour mark on Skip and Plan
 * my night, so the pair means finished. Without the tour mark the journey resumes.
 */
export const NATIVE_FIRST_RUN_LEGACY_ROUTED_KEY = "pubmax:nativeFirstRun:routed:v1";
/** Only the unfinished step is durable. Location coordinates are never stored here. */
export const NATIVE_FIRST_RUN_STEP_KEY = "pubmax:nativeFirstRun:step:v1";
/** The id of the patch an unfinished journey chose. Never coordinates. */
export const NATIVE_FIRST_RUN_PATCH_KEY = "pubmax:nativeFirstRun:patch:v1";
/**
 * The one-time onboarding eligibility slot. Exported for the same reason as
 * NATIVE_FIRST_RUN_DONE_KEY: the entry block in public/theme-init.js takes the
 * first-run branch itself and has to issue the same handoff the guarded route
 * consumes, one paint earlier.
 */
export const NATIVE_FIRST_RUN_HANDOFF_KEY = "pubmax:nativeFirstRun:handoff:v1";
const HANDOFF_KEY = NATIVE_FIRST_RUN_HANDOFF_KEY;
/** Long enough for a slow client transition, short enough to never become a bookmark. */
export const NATIVE_FIRST_RUN_HANDOFF_MAX_AGE_MS = 5 * 60 * 1000;

function hasStorage(): boolean {
  return safeLocalStorage() !== null;
}

function isNativeFirstRunDone(store: Storage): boolean {
  return (
    store.getItem(NATIVE_FIRST_RUN_DONE_KEY) === "1" ||
    (store.getItem(NATIVE_FIRST_RUN_LEGACY_ROUTED_KEY) === "1" && hasSeenTour())
  );
}

function resolveSessionStorage(storage?: Storage | null): Storage | null {
  return storage ?? safeSessionStorage();
}

export type NativeFirstRunState = {
  /** Native shell only — always false (never route) on web/SSR. */
  isNative: boolean;
  /** Onboarding was explicitly finished or skipped on this device. */
  alreadyRouted: boolean;
  /** Viewer already has a preferred-city choice persisted — has state. */
  hasCityPreference: boolean;
  /** A native journey started but has not been explicitly finished or skipped. */
  inProgress?: boolean;
};

/**
 * Pure gate function — exported for unit testing. No storage/DOM access.
 * Routes a new native viewer or an unfinished native journey to onboarding.
 */
export function shouldRouteNativeFirstRun(state: NativeFirstRunState): boolean {
  if (!state.isNative) return false;
  if (state.alreadyRouted) return false;
  if (state.inProgress) return true;
  if (state.hasCityPreference) return false;
  return true;
}

/** Whether onboarding was explicitly finished or skipped on this device. */
function hasRoutedNativeFirstRun(): boolean {
  const store = safeLocalStorage();
  if (!store) return true;
  try {
    return isNativeFirstRunDone(store);
  } catch {
    return true;
  }
}

/** Record explicit completion or Skip. No-op on SSR/storage failure. */
export function markNativeFirstRunRouted(): void {
  if (!hasStorage()) return;
  try {
    window.localStorage.setItem(NATIVE_FIRST_RUN_DONE_KEY, "1");
    window.localStorage.removeItem(NATIVE_FIRST_RUN_STEP_KEY);
    window.localStorage.removeItem(NATIVE_FIRST_RUN_PATCH_KEY);
  } catch {
    // Storage full / disabled / private mode — degrade silently; worst case
    // is that the next launch resumes the journey again, never a loop
    // (isNativeApp() still gates it, and the redirect target is idempotent).
  }
}

/**
 * Read an unfinished step. The onboarding UI validates it against its step vocabulary.
 * A journey an earlier release started stored no step, so it resumes at the first one.
 */
export function readNativeFirstRunStep(): string | null {
  const store = safeLocalStorage();
  if (!store) return null;
  try {
    if (isNativeFirstRunDone(store)) return null;
    const step = store.getItem(NATIVE_FIRST_RUN_STEP_KEY);
    if (step !== null) return step;
    return store.getItem(NATIVE_FIRST_RUN_LEGACY_ROUTED_KEY) === "1" ? "london" : null;
  } catch {
    return null;
  }
}

/** Record progress only for the native journey, until Skip or Plan my night completes it. */
export function rememberNativeFirstRunStep(step: OnboardingStep): void {
  if (!isNativeApp()) return;
  const store = safeLocalStorage();
  if (!store) return;
  try {
    if (!isNativeFirstRunDone(store)) store.setItem(NATIVE_FIRST_RUN_STEP_KEY, step);
  } catch {
    // Storage unavailable. The journey remains usable in this session.
  }
}

/** Read the patch id an unfinished journey chose. The onboarding UI validates it. */
export function readNativeFirstRunPatch(): string | null {
  const store = safeLocalStorage();
  if (!store) return null;
  try {
    return isNativeFirstRunDone(store) ? null : store.getItem(NATIVE_FIRST_RUN_PATCH_KEY);
  } catch {
    return null;
  }
}

/** Record the chosen patch id for the native journey. Null clears it: a located answer keeps no place. */
export function rememberNativeFirstRunPatch(id: string | null): void {
  if (!isNativeApp()) return;
  const store = safeLocalStorage();
  if (!store) return;
  try {
    if (id && !isNativeFirstRunDone(store)) store.setItem(NATIVE_FIRST_RUN_PATCH_KEY, id);
    else store.removeItem(NATIVE_FIRST_RUN_PATCH_KEY);
  } catch {
    // Storage unavailable. The patch still counts for this session.
  }
}

/** Start a journey without overwriting the step an interrupted launch left behind. */
export function beginNativeFirstRun(): void {
  if (readNativeFirstRunStep() === null) rememberNativeFirstRunStep("london");
}

/**
 * Issue the one-time eligibility handoff immediately before the root entry
 * decision replaces `/` with `/onboarding`. Session scope prevents a URL from
 * carrying eligibility, and the timestamp bounds abandoned transitions.
 */
export function issueNativeFirstRunHandoff(
  storage?: Storage | null,
  now: number = Date.now(),
): void {
  const store = resolveSessionStorage(storage);
  if (!store) return;
  try {
    store.setItem(HANDOFF_KEY, String(now));
  } catch {
    // Storage unavailable. The guarded route will fail closed to /tonight.
  }
}

/** Remove an abandoned or inapplicable first-run handoff. */
export function clearNativeFirstRunHandoff(storage?: Storage | null): void {
  const store = resolveSessionStorage(storage);
  if (!store) return;
  try {
    store.removeItem(HANDOFF_KEY);
  } catch {
    // ignore
  }
}

/**
 * Consume a fresh handoff once. Eligibility is native-only and always removed
 * before returning so refreshes, direct links and returning visits fail closed.
 */
export function consumeNativeFirstRunHandoff(
  isNative: boolean = isNativeApp(),
  storage?: Storage | null,
  now: number = Date.now(),
): boolean {
  const store = resolveSessionStorage(storage);
  if (!store) return false;
  let issuedAt: number | null = null;
  try {
    const raw = store.getItem(HANDOFF_KEY);
    store.removeItem(HANDOFF_KEY);
    if (raw !== null) {
      const parsed = Number(raw);
      issuedAt = Number.isFinite(parsed) ? parsed : null;
    }
  } catch {
    return false;
  }
  if (!isNative || issuedAt === null) return false;
  const age = now - issuedAt;
  return age >= 0 && age <= NATIVE_FIRST_RUN_HANDOFF_MAX_AGE_MS;
}

/** Convenience: read live isNativeApp() alongside the persisted state. */
export function getNativeFirstRunSnapshot(hasCityPreference: boolean): NativeFirstRunState {
  return {
    isNative: isNativeApp(),
    alreadyRouted: hasRoutedNativeFirstRun(),
    hasCityPreference,
    inProgress: readNativeFirstRunStep() !== null,
  };
}
