import { cleanText } from "@/lib/textClean";

export const PAL_SPECIES = ["hound", "raven", "fox"] as const;
export const SIGNAL_FAMILIES = ["beer", "gin", "rum", "whisky", "brandy", "vodka"] as const;
export const PAL_VOICES = ["ember", "velvet", "signal"] as const;
export type PubPalSpecies = (typeof PAL_SPECIES)[number];
export type SignalFamily = (typeof SIGNAL_FAMILIES)[number];
export type PubPalVoiceId = (typeof PAL_VOICES)[number];

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

export const DEFAULT_PAL_DRAFT: PubPalDraft = {
  adultConfirmed: false,
  name: "",
  appearance: { species: "hound", signalAffinity: "beer", material: "hologram", accessory: "none" },
  personality: { playfulness: 62, energy: 54, storytelling: 58, relationship: "sidekick" },
  voice: { id: "ember", pace: 50, warmth: 64, energy: 52 },
};

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
