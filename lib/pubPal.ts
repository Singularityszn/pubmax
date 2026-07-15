import { cleanText } from "@/lib/textClean";

/**
 * Eight original Pub Pal forms. The breadth mirrors the useful part of the
 * Codex pet picker (a small, memorable cast) without copying its artwork.
 */
export const PAL_SPECIES = [
  "hound",
  "raven",
  "fox",
  "cat",
  "rabbit",
  "turtle",
  "squirrel",
  "bot",
] as const;
export const PAL_ONBOARDING_SPECIES = ["hound", "raven", "fox"] as const;
export const SIGNAL_FAMILIES = ["beer", "gin", "rum", "whisky", "brandy", "vodka"] as const;
export const PAL_VOICES = ["ember", "velvet", "signal"] as const;
export type PubPalSpecies = (typeof PAL_SPECIES)[number];
export type SignalFamily = (typeof SIGNAL_FAMILIES)[number];
export type PubPalVoiceId = (typeof PAL_VOICES)[number];

export const PAL_ANIMATION_STATES = [
  "idle",
  "noticing",
  "listening",
  "thinking",
  "speaking",
  "celebrating",
  "sleeping",
  "error",
] as const;
export type PalAnimationState = (typeof PAL_ANIMATION_STATES)[number];

export type PalVisualManifest = {
  species: PubPalSpecies;
  format: "layered-svg";
  silhouette: string;
  signatureProp: string;
  supportedStates: readonly PalAnimationState[];
};

export const PAL_VISUAL_MANIFEST: Record<"hound" | "raven" | "fox", PalVisualManifest> = {
  hound: { species: "hound", format: "layered-svg", silhouette: "floppy-eared signal hound", signatureProp: "signal collar", supportedStates: PAL_ANIMATION_STATES },
  raven: { species: "raven", format: "layered-svg", silhouette: "long-beaked observant raven", signatureProp: "lore lens", supportedStates: PAL_ANIMATION_STATES },
  fox: { species: "fox", format: "layered-svg", silhouette: "sharp-eared quick fox", signatureProp: "route compass", supportedStates: PAL_ANIMATION_STATES },
};

export type PubPalPersonality = {
  playfulness: number;
  energy: number;
  storytelling: number;
  relationship: "guide" | "sidekick" | "confidant";
};

export type PubPalAppearance = {
  species: PubPalSpecies;
  signalAffinity: SignalFamily;
  material: "hologram" | "chrome" | "glass";
  accessory: "none" | "collar" | "monocle" | "signal-ring";
};

export type PubPalVoice = {
  id: PubPalVoiceId;
  pace: number;
  warmth: number;
  energy: number;
};

export type PubPal = {
  id: string;
  ownerId: string;
  name: string;
  adultAttestedAt: string;
  appearance: PubPalAppearance;
  personality: PubPalPersonality;
  voice: PubPalVoice;
  muted: boolean;
  hidden: boolean;
  masteryPoints: number;
  createdAt: string;
  updatedAt: string;
};

export type PubPalMemoryKind =
  | "venue_preference"
  | "atmosphere_preference"
  | "accessibility_preference"
  | "transport_preference"
  | "drink_preference"
  | "night_outcome"
  | "correction";

export type PubPalMemory = {
  id: string;
  palId: string;
  kind: PubPalMemoryKind;
  value: string;
  provenance: "user_confirmed" | "completed_plan" | "user_correction";
  createdAt: string;
};

export type MasteryEventKind =
  | "plan_completed"
  | "venue_discovered"
  | "pint_drop_verified"
  | "heritage_read"
  | "crew_coordinated"
  | "night_captured";

export type MasteryEvent = {
  id: string;
  palId: string;
  kind: MasteryEventKind;
  sourceId: string;
  points: number;
  createdAt: string;
};

export type PalUnlock = {
  id: string;
  pointsRequired: number;
  category: "material" | "accessory" | "animation" | "home_object" | "lore";
  label: string;
};

export type PubPalDraft = {
  adultConfirmed: boolean;
  name: string;
  appearance: PubPalAppearance;
  personality: PubPalPersonality;
  voice: PubPalVoice;
};

export type PalOnboardingPrivacy = {
  proposeMemories: boolean;
  visible: boolean;
  muted: boolean;
};

export type PalOnboardingDraftV1 = {
  version: 1;
  savedAt: string;
  step: 0 | 1 | 2 | 3 | 4;
  draft: PubPalDraft;
  privacy: PalOnboardingPrivacy;
};

export const PAL_ONBOARDING_DRAFT_KEY = "pubmaxx.pub-pal-onboarding.v1";

export const DEFAULT_PAL_DRAFT: PubPalDraft = {
  adultConfirmed: false,
  name: "",
  appearance: { species: "hound", signalAffinity: "beer", material: "hologram", accessory: "none" },
  personality: { playfulness: 62, energy: 54, storytelling: 58, relationship: "sidekick" },
  voice: { id: "ember", pace: 50, warmth: 64, energy: 52 },
};

export function readPalOnboardingDraft(): PalOnboardingDraftV1 | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = JSON.parse(window.localStorage.getItem(PAL_ONBOARDING_DRAFT_KEY) ?? "null") as Partial<PalOnboardingDraftV1> | null;
    if (!raw || raw.version !== 1 || !raw.draft || !raw.privacy) return null;
    const draft = raw.draft as PubPalDraft;
    if (
      typeof draft.adultConfirmed !== "boolean" ||
      typeof draft.name !== "string" || draft.name.length > 32 ||
      !PAL_SPECIES.includes(draft.appearance?.species) ||
      !SIGNAL_FAMILIES.includes(draft.appearance?.signalAffinity) ||
      !["hologram", "chrome", "glass"].includes(draft.appearance?.material) ||
      !["none", "collar", "monocle", "signal-ring"].includes(draft.appearance?.accessory) ||
      !PAL_VOICES.includes(draft.voice?.id) ||
      !["guide", "sidekick", "confidant"].includes(draft.personality?.relationship)
    ) return null;
    const step = Number.isInteger(raw.step) && Number(raw.step) >= 0 && Number(raw.step) <= 4
      ? raw.step as PalOnboardingDraftV1["step"]
      : 0;
    return {
      version: 1,
      savedAt: typeof raw.savedAt === "string" ? raw.savedAt : new Date(0).toISOString(),
      step,
      draft,
      privacy: {
        proposeMemories: raw.privacy.proposeMemories === true,
        visible: raw.privacy.visible !== false,
        muted: raw.privacy.muted === true,
      },
    };
  } catch {
    return null;
  }
}

export function writePalOnboardingDraft(value: Omit<PalOnboardingDraftV1, "version" | "savedAt">): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PAL_ONBOARDING_DRAFT_KEY, JSON.stringify({
      ...value,
      version: 1,
      savedAt: new Date().toISOString(),
    } satisfies PalOnboardingDraftV1));
  } catch {
    // Best-effort recovery in private/quota-constrained browsers.
  }
}

export function clearPalOnboardingDraft(): void {
  if (typeof window === "undefined") return;
  try { window.localStorage.removeItem(PAL_ONBOARDING_DRAFT_KEY); } catch { /* best effort */ }
}

export function cleanPalDraft(value: unknown): PubPalDraft | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const appearance = raw.appearance as Record<string, unknown> | undefined;
  const personality = raw.personality as Record<string, unknown> | undefined;
  const voice = raw.voice as Record<string, unknown> | undefined;
  const name = cleanText(raw.name, 32);
  if (!name || raw.adultConfirmed !== true || !appearance || !personality || !voice) return null;
  if (!PAL_SPECIES.includes(appearance.species as PubPalSpecies)) return null;
  if (!SIGNAL_FAMILIES.includes(appearance.signalAffinity as SignalFamily)) return null;
  if (!PAL_VOICES.includes(voice.id as PubPalVoiceId)) return null;
  const clamp = (input: unknown) => Math.max(0, Math.min(100, Number(input) || 0));
  const relationship = ["guide", "sidekick", "confidant"].includes(String(personality.relationship))
    ? personality.relationship as PubPalPersonality["relationship"] : "sidekick";
  return {
    adultConfirmed: true,
    name,
    appearance: {
      species: appearance.species as PubPalSpecies,
      signalAffinity: appearance.signalAffinity as SignalFamily,
      material: ["hologram", "chrome", "glass"].includes(String(appearance.material)) ? appearance.material as PubPalAppearance["material"] : "hologram",
      accessory: ["none", "collar", "monocle", "signal-ring"].includes(String(appearance.accessory)) ? appearance.accessory as PubPalAppearance["accessory"] : "none",
    },
    personality: { playfulness: clamp(personality.playfulness), energy: clamp(personality.energy), storytelling: clamp(personality.storytelling), relationship },
    voice: { id: voice.id as PubPalVoiceId, pace: clamp(voice.pace), warmth: clamp(voice.warmth), energy: clamp(voice.energy) },
  };
}

export const PAL_UNLOCKS: PalUnlock[] = [
  { id: "signal-ring", pointsRequired: 40, category: "accessory", label: "Signal ring" },
  { id: "gin-glass", pointsRequired: 90, category: "material", label: "Gin crystal" },
  { id: "victorian-lore", pointsRequired: 140, category: "lore", label: "Victorian London chapter" },
];
