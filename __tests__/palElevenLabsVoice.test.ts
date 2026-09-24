import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PAL_DRAFT } from "@/lib/pubPal";
import {
  elevenLabsVoiceEnvKeyForSpecies,
  resolveElevenLabsVoiceIdForPal,
} from "@/lib/palElevenLabsVoice";

describe("resolveElevenLabsVoiceIdForPal", () => {
  const basePal = {
    id: "pal-1",
    ownerId: "owner-1",
    name: "Ripley",
    adultAttestedAt: "2026-08-08T00:00:00.000Z",
    appearance: { ...DEFAULT_PAL_DRAFT.appearance, species: "fox" as const },
    personality: DEFAULT_PAL_DRAFT.personality,
    voice: DEFAULT_PAL_DRAFT.voice,
    muted: false,
    hidden: false,
    proposalPreferences: { memories: false, routes: true },
    masteryPoints: 0,
    createdAt: "2026-08-08T00:00:00.000Z",
    updatedAt: "2026-08-08T00:00:00.000Z",
  };

  beforeEach(() => { vi.unstubAllEnvs(); });
  afterEach(() => { vi.unstubAllEnvs(); });

  it("names species env keys in uppercase", () => {
    expect(elevenLabsVoiceEnvKeyForSpecies("fox")).toBe("ELEVENLABS_VOICE_FOX");
  });

  it("prefers the species voice id over legacy slots", () => {
    vi.stubEnv("ELEVENLABS_VOICE_FOX", "voice-fox-id");
    vi.stubEnv("ELEVENLABS_VOICE_EMBER", "voice-ember-id");
    expect(resolveElevenLabsVoiceIdForPal(basePal)).toBe("voice-fox-id");
  });

  it("falls back to legacy ember for fox when species unset", () => {
    vi.stubEnv("ELEVENLABS_VOICE_EMBER", "voice-ember-id");
    expect(resolveElevenLabsVoiceIdForPal(basePal)).toBe("voice-ember-id");
  });

  it("returns null when nothing is configured", () => {
    expect(resolveElevenLabsVoiceIdForPal(basePal)).toBeNull();
  });
});
