import {
  onboardingPalSpecies,
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
 * ElevenLabs voice id for a live session: the person's own ember / velvet /
 * signal pick whenever its slot is set, otherwise the voice designed for the
 * Pal's species (legacy species borrow their onboarding counterpart's voice),
 * and null (agent default) when neither is set.
 */
export function resolveElevenLabsVoiceIdForPal(pal: PubPal): string | null {
  const picked = readEnvVoiceId(PICKED_VOICE_ENV_KEYS[pal.voice.id]);
  if (picked) return picked;
  const species = onboardingPalSpecies(pal.appearance.species);
  return species ? readEnvVoiceId(elevenLabsVoiceEnvKeyForSpecies(species)) : null;
}
