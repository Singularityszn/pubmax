import {
  PAL_ONBOARDING_SPECIES,
  type PubPalSpecies,
} from "@/lib/pubPal";

export const PAL_GUEST_PROMPT_LIMIT = 5;
export const PAL_GUEST_TRIAL_KEY = "pubmaxx.pub-pal-guest-trial.v1";

export type PalGuestInputMode = "talk" | "text";

export type PalGuestTrialState = Readonly<{
  answeredPrompts: number;
  species: PubPalSpecies;
  mode: PalGuestInputMode;
}>;

const DEFAULT_GUEST_TRIAL: PalGuestTrialState = {
  answeredPrompts: 0,
  species: "robin",
  mode: "text",
};

function isLaunchSpecies(value: unknown): value is PubPalSpecies {
  return typeof value === "string"
    && PAL_ONBOARDING_SPECIES.includes(value as (typeof PAL_ONBOARDING_SPECIES)[number]);
}

function isInputMode(value: unknown): value is PalGuestInputMode {
  return value === "talk" || value === "text";
}

function boundedPromptCount(value: unknown): number {
  const count = Number.isFinite(value) ? Math.floor(Number(value)) : 0;
  return Math.max(0, Math.min(PAL_GUEST_PROMPT_LIMIT, count));
}

export function readPalGuestTrial(storage: Storage | null | undefined): PalGuestTrialState {
  try {
    const raw = JSON.parse(storage?.getItem(PAL_GUEST_TRIAL_KEY) ?? "null") as Record<string, unknown> | null;
    if (!raw || raw.version !== 1) return DEFAULT_GUEST_TRIAL;
    return {
      answeredPrompts: boundedPromptCount(raw.answeredPrompts),
      species: isLaunchSpecies(raw.species) ? raw.species : "robin",
      mode: isInputMode(raw.mode) ? raw.mode : "text",
    };
  } catch {
    return DEFAULT_GUEST_TRIAL;
  }
}

function writePalGuestTrial(
  storage: Storage | null | undefined,
  state: PalGuestTrialState,
): PalGuestTrialState {
  const bounded: PalGuestTrialState = {
    answeredPrompts: boundedPromptCount(state.answeredPrompts),
    species: isLaunchSpecies(state.species) ? state.species : "robin",
    mode: isInputMode(state.mode) ? state.mode : "text",
  };
  try {
    storage?.setItem(PAL_GUEST_TRIAL_KEY, JSON.stringify({ version: 1, ...bounded }));
  } catch {
    // Guest chat still works when browser storage is unavailable.
  }
  return bounded;
}

export function writePalGuestChoice(
  storage: Storage | null | undefined,
  species: PubPalSpecies,
  mode: PalGuestInputMode,
): PalGuestTrialState {
  return writePalGuestTrial(storage, {
    ...readPalGuestTrial(storage),
    species,
    mode,
  });
}

export function recordPalGuestAnswer(
  storage: Storage | null | undefined,
  amount = 1,
): PalGuestTrialState {
  const current = readPalGuestTrial(storage);
  return writePalGuestTrial(storage, {
    ...current,
    answeredPrompts: current.answeredPrompts + Math.max(0, Math.floor(amount)),
  });
}

export function palGuestChatHref(
  species: PubPalSpecies,
  mode: PalGuestInputMode,
): string {
  const params = new URLSearchParams({ mode, pal: species });
  return `/pal/chat?${params.toString()}`;
}

export function palGuestSignupHref(): string {
  const params = new URLSearchParams({ mode: "signup", from: "/pal" });
  return `/login?${params.toString()}`;
}

