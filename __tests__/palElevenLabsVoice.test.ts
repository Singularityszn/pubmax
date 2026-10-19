import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PAL_DRAFT } from "@/lib/pubPal";
import { buildPalVoiceOverrides } from "@/lib/palVoiceOverrides";
import { buildPalTaste } from "@/lib/palTaste";
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

  it("greets a returning person with their own logged visit and price, without inventing a total spend", () => {
    const taste = buildPalTaste({ diary: [], saved: [],
      drops: [{ venueId: "crown", day: "2026-10-10", drink: "Camden Hells", pintPriceGbp: 5.8, vibeTags: [] }],
      placeOf: () => ({ name: "The Crown", patch: "Soho" }),
    });
    const greeting = buildPalVoiceOverrides(basePal, { taste }).firstMessage;
    expect(greeting).toBe("Hi, I'm Ripley. Last time, you logged The Crown on 10 October 2026, with Camden Hells at £5.80 a pint. Something similar tonight?");
    expect(greeting).not.toContain("spent");
  });

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

  it.each([
    ["voice-picked", "voice-species", "selected", "voice-picked"],
    ["", "voice-species", "species", "voice-species"],
    ["", "", "agent-default", null],
  ])("names the actual voice selection in the grant metadata", (picked, species, source, voiceId) => {
    vi.stubEnv("ELEVENLABS_VOICE_EMBER", picked);
    vi.stubEnv("ELEVENLABS_VOICE_FOX", species);
    expect(buildPalVoiceOverrides(basePal)).toEqual({
      voiceId,
      voiceSource: source,
      firstMessage: "Hi, I'm Ripley. What kind of night are you planning?",
    });
  });
});
