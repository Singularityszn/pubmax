import {
  PAL_ONBOARDING_SPECIES,
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

const LEGACY_VOICE_ENV_KEYS: Record<PubPalVoiceId, string> = {
  ember: "ELEVENLABS_VOICE_EMBER",
  velvet: "ELEVENLABS_VOICE_VELVET",
  signal: "ELEVENLABS_VOICE_SIGNAL",
};

/**
 * When only the legacy ember / velvet / signal slots are set, each onboarding
 * species maps to one slot so every Pal still gets a distinct override where
 * possible. Replace with per-species ids via voice design (docs/PUB_PAL_SETUP.md).
 */
export const LEGACY_VOICE_SLOT_BY_ONBOARDING_SPECIES: Record<
  (typeof PAL_ONBOARDING_SPECIES)[number],
  PubPalVoiceId
> = {
  robin: "ember",
  greyhound: "velvet",
  cat: "signal",
  fox: "ember",
  pigeon: "velvet",
  badger: "signal",
  corgi: "ember",
};

function readEnvVoiceId(key: string): string | null {
  const value = process.env[key]?.trim();
  return value || null;
}

function resolveFromLegacySlots(pal: PubPal, species: PubPalSpecies): string | null {
  if (PAL_ONBOARDING_SPECIES.includes(species as (typeof PAL_ONBOARDING_SPECIES)[number])) {
    const slot =
      LEGACY_VOICE_SLOT_BY_ONBOARDING_SPECIES[
        species as (typeof PAL_ONBOARDING_SPECIES)[number]
      ];
    const fromSlot = readEnvVoiceId(LEGACY_VOICE_ENV_KEYS[slot]);
    if (fromSlot) return fromSlot;
  }
  return readEnvVoiceId(LEGACY_VOICE_ENV_KEYS[pal.voice.id]);
}

/**
 * ElevenLabs voice id for a live session: species voice first, then legacy slot
 * bridge, then the Pal's ember/velvet/signal pick, then null (agent default).
 */
export function resolveElevenLabsVoiceIdForPal(pal: PubPal): string | null {
  const species = compatiblePalSpecies(pal.appearance.species) ?? pal.appearance.species;
  const fromSpecies = readEnvVoiceId(elevenLabsVoiceEnvKeyForSpecies(species));
  if (fromSpecies) return fromSpecies;
  return resolveFromLegacySlots(pal, species);
}
