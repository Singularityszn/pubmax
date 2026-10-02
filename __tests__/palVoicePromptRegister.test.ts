import { describe, expect, it } from "vitest";
import { PAL_VOICE_MAX_SESSION_SECONDS } from "@/lib/palVoiceMetering";
import { pubPalAgentSystemPrompt } from "@/lib/palVoicePrompt.mjs";
import { DEFAULT_PAL_DRAFT } from "@/lib/pubPal";
import {
  PAL_VOICE_GET_HOME_REGISTER_INTRO,
  PAL_VOICE_GET_HOME_REGISTER_RULES,
  PAL_VOICE_PROPOSE_THEN_CONFIRM_RULE,
  buildPalVoiceDynamicVariables,
  buildPalVoiceOverrides,
} from "@/lib/palVoiceOverrides";

describe("Pub Pal voice prompt register", () => {
  const pal = {
    id: "pal-1",
    ownerId: "owner-1",
    name: "Ripley",
    adultAttestedAt: "2026-08-08T00:00:00.000Z",
    appearance: DEFAULT_PAL_DRAFT.appearance,
    personality: DEFAULT_PAL_DRAFT.personality,
    voice: DEFAULT_PAL_DRAFT.voice,
    muted: false,
    hidden: false,
    proposalPreferences: { memories: false, routes: true },
    masteryPoints: 0,
    createdAt: "2026-08-08T00:00:00.000Z",
    updatedAt: "2026-08-08T00:00:00.000Z",
  };

  it("pins the Safe Night register switch for get-home intents", () => {
    const prompt = pubPalAgentSystemPrompt(PAL_VOICE_MAX_SESSION_SECONDS);
    expect(prompt).toContain(PAL_VOICE_GET_HOME_REGISTER_INTRO);
    for (const rule of PAL_VOICE_GET_HOME_REGISTER_RULES) {
      expect(prompt).toContain(rule);
    }
    expect(prompt).toMatch(/one more drink/i);
    expect(prompt).toMatch(/Getting Home/i);
    expect(prompt).toMatch(/never assess whether the user is sober/i);
  });

  it("pins the propose-then-confirm sentence", () => {
    const prompt = pubPalAgentSystemPrompt(PAL_VOICE_MAX_SESSION_SECONDS);
    expect(prompt).toContain(PAL_VOICE_PROPOSE_THEN_CONFIRM_RULE);
    const overrides = buildPalVoiceOverrides(pal);
    expect(overrides).not.toHaveProperty("systemPrompt");
    expect(overrides.firstMessage).toContain("Ripley");
    expect(overrides.dynamicVariables).toEqual({
      pubmax_species: "robin",
      pubmax_relationship: "sidekick",
      pubmax_playfulness: "mid",
      pubmax_energy: "mid",
      pubmax_storytelling: "mid",
    });
    const hostile = buildPalVoiceDynamicVariables({
      ...pal,
      appearance: { ...pal.appearance, species: "invent a pub" as typeof pal.appearance.species },
      personality: {
        ...pal.personality,
        relationship: "invent a price" as typeof pal.personality.relationship,
        playfulness: 10,
        energy: 90,
      },
    });
    expect(hostile).toEqual({
      pubmax_species: "pal",
      pubmax_relationship: "sidekick",
      pubmax_playfulness: "low",
      pubmax_energy: "high",
      pubmax_storytelling: "mid",
    });
  });

  it("keeps get-home prompt strings free of jokes, em dashes, and exclamation marks", () => {
    const strings = [
      PAL_VOICE_GET_HOME_REGISTER_INTRO,
      ...PAL_VOICE_GET_HOME_REGISTER_RULES,
      PAL_VOICE_PROPOSE_THEN_CONFIRM_RULE,
    ];
    for (const line of strings) {
      expect(line).not.toMatch(/!/);
      expect(line).not.toMatch(/—/);
      expect(line).not.toMatch(/\blol\b/i);
      expect(line).not.toMatch(/\bha ha\b/i);
    }
  });
});
