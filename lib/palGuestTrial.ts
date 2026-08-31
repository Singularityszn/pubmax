import {
  compatiblePalSpecies,
  type PubPalSpecies,
} from "@/lib/pubPal";

export const PAL_GUEST_TRIAL_STORAGE_KEY = "pubmaxx.pub-pal-guest-trial.v1";
export const PAL_GUEST_TRIAL_VERSION = 1 as const;
// Browser-local conversion gate. This is not an API entitlement or security
// boundary. The Ask route keeps its own abuse controls.
export const PAL_GUEST_ANSWER_LIMIT = 5;
export const PAL_GUEST_TURN_LOCK_NAME = "pubmaxx.pub-pal-guest-trial.turn";

export type PalGuestMode = "talk" | "text";
export type PalGuestTrialState = {
  version: typeof PAL_GUEST_TRIAL_VERSION;
  answeredPrompts: number;
  species: PubPalSpecies;
  mode: PalGuestMode;
};

export type PalGuestStorage = Pick<Storage, "getItem" | "setItem">;
export type PalGuestLockManager = {
  request: <T>(
    name: string,
    options: { mode: "exclusive" },
    callback: () => Promise<T>,
  ) => Promise<T>;
};

export const DEFAULT_PAL_GUEST_TRIAL: PalGuestTrialState = {
  version: PAL_GUEST_TRIAL_VERSION,
  answeredPrompts: 0,
  species: "robin",
  mode: "text",
};

function browserStorage(): PalGuestStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function browserLockManager(): PalGuestLockManager | null {
  if (typeof navigator === "undefined") return null;
  const locks = (navigator as Navigator & {
    locks?: PalGuestLockManager;
  }).locks;
  return locks ?? null;
}

/** Serialise one guest answer across this browser's tabs when Web Locks exist. */
export function withPalGuestTurnLock<T>(
  callback: () => Promise<T>,
  lockManager: PalGuestLockManager | null = browserLockManager(),
): Promise<T> {
  if (!lockManager) return callback();
  return lockManager.request(
    PAL_GUEST_TURN_LOCK_NAME,
    { mode: "exclusive" },
    callback,
  );
}

function cleanAnswerCount(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.min(PAL_GUEST_ANSWER_LIMIT, Math.max(0, Math.trunc(value)));
}

function cleanGuestTrial(value: unknown): PalGuestTrialState {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ...DEFAULT_PAL_GUEST_TRIAL };
  }
  const record = value as Record<string, unknown>;
  if (record.version !== PAL_GUEST_TRIAL_VERSION) {
    return { ...DEFAULT_PAL_GUEST_TRIAL };
  }
  return {
    version: PAL_GUEST_TRIAL_VERSION,
    answeredPrompts: cleanAnswerCount(record.answeredPrompts),
    species: compatiblePalSpecies(record.species) ?? DEFAULT_PAL_GUEST_TRIAL.species,
    mode: record.mode === "talk" || record.mode === "text"
      ? record.mode
      : DEFAULT_PAL_GUEST_TRIAL.mode,
  };
}

function persistPalGuestTrial(
  state: PalGuestTrialState,
  storage: PalGuestStorage | null,
): PalGuestTrialState {
  try {
    storage?.setItem(PAL_GUEST_TRIAL_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Private browsing and storage policy can block localStorage. Guest chat
    // still works for this page lifetime; no prompt or transcript is retained.
  }
  return state;
}

export function readPalGuestTrial(
  storage: PalGuestStorage | null = browserStorage(),
): PalGuestTrialState {
  try {
    const raw = storage?.getItem(PAL_GUEST_TRIAL_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_PAL_GUEST_TRIAL };
    return cleanGuestTrial(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_PAL_GUEST_TRIAL };
  }
}

export function writePalGuestChoice(
  species: PubPalSpecies,
  mode: PalGuestMode,
  storage: PalGuestStorage | null = browserStorage(),
  currentState?: PalGuestTrialState,
): PalGuestTrialState {
  const stored = readPalGuestTrial(storage);
  const current = currentState ? cleanGuestTrial(currentState) : stored;
  const state: PalGuestTrialState = {
    version: PAL_GUEST_TRIAL_VERSION,
    answeredPrompts: Math.max(
      current.answeredPrompts,
      stored.answeredPrompts,
    ),
    species: compatiblePalSpecies(species) ?? DEFAULT_PAL_GUEST_TRIAL.species,
    mode: mode === "talk" ? "talk" : "text",
  };
  return persistPalGuestTrial(state, storage);
}

export function recordPalGuestAnswer(
  storage: PalGuestStorage | null = browserStorage(),
  currentState?: PalGuestTrialState,
): PalGuestTrialState {
  const stored = readPalGuestTrial(storage);
  const current = currentState ? cleanGuestTrial(currentState) : stored;
  return persistPalGuestTrial({
    ...current,
    answeredPrompts: Math.min(
      PAL_GUEST_ANSWER_LIMIT,
      Math.max(current.answeredPrompts, stored.answeredPrompts) + 1,
    ),
  }, storage);
}

export function isPalGuestTrialComplete(
  stateOrCount: PalGuestTrialState | number,
): boolean {
  const count = typeof stateOrCount === "number"
    ? stateOrCount
    : stateOrCount.answeredPrompts;
  return Number.isFinite(count) && count >= PAL_GUEST_ANSWER_LIMIT;
}

export function palGuestResultConsumesAnswer(
  result: { status?: unknown } | null | undefined,
): boolean {
  return result?.status === "answered" || result?.status === "empty";
}

export function palGuestChatHref(
  species: PubPalSpecies,
  mode: PalGuestMode,
): string {
  const safeSpecies = compatiblePalSpecies(species) ?? DEFAULT_PAL_GUEST_TRIAL.species;
  const safeMode: PalGuestMode = mode === "talk" ? "talk" : "text";
  return `/pal/chat?trial=1&mode=${safeMode}&pal=${safeSpecies}`;
}

export function palGuestSignupHref(): string {
  return "/login?mode=signup&from=%2Fpal";
}
