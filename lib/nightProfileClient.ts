import {
  cleanNightProfileInput,
  nightProfileInput,
  NIGHT_PROFILE_VERSION,
  type NightProfile,
  type NightProfileInput,
} from "@/lib/nightProfile";

export const NIGHT_PROFILE_DEVICE_KEY = "pubmaxx.night-profile.v1:device";

type StoredNightProfileDraft = {
  version: typeof NIGHT_PROFILE_VERSION;
  profile: NightProfileInput;
};

function browserStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readDeviceNightProfile(storage = browserStorage()): NightProfileInput | null {
  if (!storage) return null;
  try {
    const value = JSON.parse(storage.getItem(NIGHT_PROFILE_DEVICE_KEY) ?? "null") as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const envelope = value as Partial<StoredNightProfileDraft>;
    if (envelope.version !== NIGHT_PROFILE_VERSION) return null;
    return cleanNightProfileInput(envelope.profile);
  } catch {
    return null;
  }
}

export function writeDeviceNightProfile(
  profile: NightProfileInput,
  storage = browserStorage(),
): boolean {
  if (!storage) return false;
  const clean = cleanNightProfileInput(profile);
  if (!clean) return false;
  try {
    storage.setItem(
      NIGHT_PROFILE_DEVICE_KEY,
      JSON.stringify({ version: NIGHT_PROFILE_VERSION, profile: clean } satisfies StoredNightProfileDraft),
    );
    return true;
  } catch {
    return false;
  }
}

export function clearDeviceNightProfile(storage = browserStorage()): void {
  try {
    storage?.removeItem(NIGHT_PROFILE_DEVICE_KEY);
  } catch {
    // Storage is best effort; a failed clear must not erase the server profile.
  }
}

export type NightProfileMergeState =
  | { kind: "none" }
  | { kind: "device-only"; device: NightProfileInput }
  | { kind: "conflict"; device: NightProfileInput; account: NightProfile };

/**
 * Detection only. It never picks a winner: importing device preferences is a
 * consequential account write and always requires an explicit UI choice.
 */
export function nightProfileMergeState(
  device: NightProfileInput | null,
  account: NightProfile | null,
): NightProfileMergeState {
  if (!device) return { kind: "none" };
  if (!account) return { kind: "device-only", device };
  const accountInput = nightProfileInput(account);
  return JSON.stringify(device) === JSON.stringify(accountInput)
    ? { kind: "none" }
    : { kind: "conflict", device, account };
}

export type NightProfileMergeChoice = "bring-device" | "keep-account";

export function confirmedNightProfileMerge(
  state: Exclude<NightProfileMergeState, { kind: "none" }>,
  choice: NightProfileMergeChoice,
): { profile: NightProfileInput; expectedUpdatedAt: string | null; writesAccount: boolean } {
  if (choice === "keep-account" && state.kind === "conflict") {
    return {
      profile: nightProfileInput(state.account),
      expectedUpdatedAt: state.account.updatedAt,
      writesAccount: false,
    };
  }
  if (choice === "keep-account") {
    // With no account row, "start fresh" means retain the local draft until
    // the person edits/saves it; it must not create an account row silently.
    return { profile: state.device, expectedUpdatedAt: null, writesAccount: false };
  }
  return {
    profile: state.device,
    expectedUpdatedAt: state.kind === "conflict" ? state.account.updatedAt : null,
    writesAccount: true,
  };
}

export function subscribeDeviceNightProfile(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onStorage = (event: StorageEvent) => {
    if (event.storageArea === window.localStorage && event.key === NIGHT_PROFILE_DEVICE_KEY) {
      listener();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => window.removeEventListener("storage", onStorage);
}
