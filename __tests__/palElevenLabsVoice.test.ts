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

  it("keeps an ember pick over the fox species voice", () => {
    vi.stubEnv("ELEVENLABS_VOICE_FOX", "voice-fox-id");
    vi.stubEnv("ELEVENLABS_VOICE_EMBER", "voice-ember-id");
    expect(resolveElevenLabsVoiceIdForPal(basePal)).toBe("voice-ember-id");
  });

  it("keeps a velvet pick over the fox species voice", () => {
    vi.stubEnv("ELEVENLABS_VOICE_FOX", "voice-fox-id");
    vi.stubEnv("ELEVENLABS_VOICE_VELVET", "voice-velvet-id");
    const pal = { ...basePal, voice: { ...basePal.voice, id: "velvet" as const } };
    expect(resolveElevenLabsVoiceIdForPal(pal)).toBe("voice-velvet-id");
  });

  it("uses the species voice when the picked slot is empty", () => {
    vi.stubEnv("ELEVENLABS_VOICE_FOX", "voice-fox-id");
    vi.stubEnv("ELEVENLABS_VOICE_EMBER", "voice-ember-id");
    const pal = { ...basePal, voice: { ...basePal.voice, id: "signal" as const } };
    expect(resolveElevenLabsVoiceIdForPal(pal)).toBe("voice-fox-id");
  });

  it("gives a legacy hound the greyhound voice", () => {
    vi.stubEnv("ELEVENLABS_VOICE_GREYHOUND", "voice-greyhound-id");
    const pal = {
      ...basePal,
      appearance: { ...basePal.appearance, species: "hound" as const },
      voice: { ...basePal.voice, id: "signal" as const },
    };
    expect(resolveElevenLabsVoiceIdForPal(pal)).toBe("voice-greyhound-id");
  });

  it("reads no voice key for a legacy species with no onboarding counterpart", () => {
    vi.stubEnv("ELEVENLABS_VOICE_RAVEN", "voice-raven-id");
    const pal = {
      ...basePal,
      appearance: { ...basePal.appearance, species: "raven" as const },
      voice: { ...basePal.voice, id: "signal" as const },
    };
    expect(resolveElevenLabsVoiceIdForPal(pal)).toBeNull();
  });

  it("returns null when nothing is configured", () => {
    expect(resolveElevenLabsVoiceIdForPal(basePal)).toBeNull();
  });
});
