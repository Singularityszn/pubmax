import { PAL_VOICE_DYNAMIC_DEFAULTS } from "@/lib/palVoicePrompt.mjs";
import { resolveElevenLabsVoiceIdForPal } from "@/lib/palElevenLabsVoice";
import type { PubPal } from "@/lib/pubPal";
import { onboardingPalSpecies } from "@/lib/pubPal";

export {
  PAL_VOICE_GET_HOME_REGISTER_INTRO,
  PAL_VOICE_GET_HOME_REGISTER_RULES,
  PAL_VOICE_PROPOSE_THEN_CONFIRM_RULE,
} from "@/lib/palVoicePrompt.mjs";

export type PalVoiceSliderBand = "low" | "mid" | "high";
export type PalVoiceRelationshipLabel = "guide" | "sidekick" | "confidant";

/** Closed persona slots. The browser forwards these. It does not write the system prompt. */
export type PalVoiceDynamicVariables = {
  pubmax_species: string;
  pubmax_relationship: PalVoiceRelationshipLabel;
  pubmax_playfulness: PalVoiceSliderBand;
  pubmax_energy: PalVoiceSliderBand;
  pubmax_storytelling: PalVoiceSliderBand;
};

export type PalVoiceOverrides = {
  voiceId: string | null;
  firstMessage: string;
  dynamicVariables: PalVoiceDynamicVariables;
};

const RELATIONSHIPS = ["guide", "sidekick", "confidant"] as const;
const ONBOARDING_SPECIES = ["robin", "greyhound", "cat", "fox", "pigeon", "badger", "corgi", "pal"] as const;

export function palVoiceSliderBand(value: number): PalVoiceSliderBand {
  if (value <= 35) return "low";
  if (value >= 70) return "high";
  return "mid";
}

function closedRelationship(value: PubPal["personality"]["relationship"]): PalVoiceRelationshipLabel {
  return (RELATIONSHIPS as readonly string[]).includes(value) ? value : "sidekick";
}

function closedSpecies(value: PubPal["appearance"]["species"]): (typeof ONBOARDING_SPECIES)[number] {
  const species = onboardingPalSpecies(value);
  return species && (ONBOARDING_SPECIES as readonly string[]).includes(species) ? species : "pal";
}

/** Server-built persona. Values are closed words from the stored Pal, never request text. */
export function buildPalVoiceDynamicVariables(pal: PubPal): PalVoiceDynamicVariables {
  return {
    pubmax_species: closedSpecies(pal.appearance.species),
    pubmax_relationship: closedRelationship(pal.personality.relationship),
    pubmax_playfulness: palVoiceSliderBand(pal.personality.playfulness),
    pubmax_energy: palVoiceSliderBand(pal.personality.energy),
    pubmax_storytelling: palVoiceSliderBand(pal.personality.storytelling),
  };
}

export function buildPalVoiceOverrides(pal: PubPal): PalVoiceOverrides {
  return {
    voiceId: resolveElevenLabsVoiceIdForPal(pal),
    firstMessage: `Hi, I'm ${pal.name}. What kind of night are you planning?`,
    dynamicVariables: buildPalVoiceDynamicVariables(pal),
  };
}

export function palVoiceChatDynamicVariables(cityId: string): Record<string, string> {
  return {
    ...PAL_VOICE_DYNAMIC_DEFAULTS,
    pubmax_city_id: cityId,
  };
}
