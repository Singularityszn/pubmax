import {
  DEFAULT_PAL_DRAFT,
  compatiblePalSpecies,
  type PubPal,
  type PubPalSpecies,
  type PubPalVoiceId,
} from "@/lib/pubPal";

/** Server env name for a Pal species voice (e.g. fox → ELEVENLABS_VOICE_FOX). */
export function elevenLabsVoiceEnvKeyForSpecies(species: PubPalSpecies): string {
  const normalized = species.replace(/-/g, "_").toUpperCase();
  return `ELEVENLABS_VOICE_${normalized}`;
}

const PICKED_VOICE_ENV_KEYS: Record<PubPalVoiceId, string> = {
  ember: "ELEVENLABS_VOICE_EMBER",
  velvet: "ELEVENLABS_VOICE_VELVET",
  signal: "ELEVENLABS_VOICE_SIGNAL",
};

function readEnvVoiceId(key: string): string | null {
  const value = process.env[key]?.trim();
  return value || null;
}

/**
 * Onboarding preselects the default voice, so keeping it is indistinguishable
 * from never choosing. Any other ember / velvet / signal pick is the person's
 * own choice and always beats the species voice.
 */
export function hasMeaningfulVoicePick(pal: PubPal): boolean {
  return pal.voice.id !== DEFAULT_PAL_DRAFT.voice.id;
}

/**
 * ElevenLabs voice id for a live session: the person's own voice pick when it
 * is configured, otherwise the species voice, otherwise the picked slot, and
 * null (agent default) when nothing is set.
 */
export function resolveElevenLabsVoiceIdForPal(pal: PubPal): string | null {
  const picked = readEnvVoiceId(PICKED_VOICE_ENV_KEYS[pal.voice.id]);
  if (hasMeaningfulVoicePick(pal) && picked) return picked;
  const species = compatiblePalSpecies(pal.appearance.species) ?? pal.appearance.species;
  return readEnvVoiceId(elevenLabsVoiceEnvKeyForSpecies(species)) ?? picked;
}
