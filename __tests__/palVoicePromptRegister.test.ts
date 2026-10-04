import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PAL_RECALL_MEMORIES_TOOL } from "@/lib/palConfirmedMemories.server";
import { PAL_PROPOSE_MEMORY_TOOL } from "@/lib/palMemoryProposal.server";
import { PAL_VOICE_MAX_SESSION_SECONDS } from "@/lib/palVoiceMetering";
import { PAL_VOICE_PRE_TOOL_LINE_RULE, pubPalAgentSystemPrompt } from "@/lib/palVoicePrompt.mjs";
import { DEFAULT_PAL_DRAFT } from "@/lib/pubPal";
import {
  PAL_VOICE_GET_HOME_REGISTER_INTRO,
  PAL_VOICE_GET_HOME_REGISTER_RULES,
  PAL_VOICE_PROPOSE_MEMORY_RULE,
  PAL_VOICE_PROPOSE_THEN_CONFIRM_RULE,
  PAL_VOICE_RECALL_MEMORIES_RULE,
  PAL_VOICE_SESSION_SUMMARY_RULE,
  buildPalVoiceOverrides,
} from "@/lib/palVoiceOverrides";

const agentConfig = JSON.parse(
  readFileSync(path.join(process.cwd(), "scripts/pubpal/pub-pal-agent-config.json"), "utf8"),
) as { toolNames: string[] };

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
    expect(Object.keys(overrides).sort()).toEqual(["firstMessage", "voiceId"]);
    expect(overrides.firstMessage).toContain("Ripley");
  });

  it("asks for a checking line before each tool that states no fact", () => {
    const prompt = pubPalAgentSystemPrompt(PAL_VOICE_MAX_SESSION_SECONDS);
    expect(prompt).toContain(PAL_VOICE_PRE_TOOL_LINE_RULE);
  });

  it("emits the memory and summary rules, and every Pal-only tool it names is one the agent is given", () => {
    const prompt = pubPalAgentSystemPrompt(PAL_VOICE_MAX_SESSION_SECONDS);
    for (const rule of [
      PAL_VOICE_RECALL_MEMORIES_RULE,
      PAL_VOICE_PROPOSE_MEMORY_RULE,
      PAL_VOICE_SESSION_SUMMARY_RULE,
    ]) {
      expect(prompt).toContain(rule);
    }
    for (const tool of [PAL_RECALL_MEMORIES_TOOL, PAL_PROPOSE_MEMORY_TOOL]) {
      expect(prompt).toContain(tool);
      expect(agentConfig.toolNames).toContain(tool);
    }
  });

  it("leaves no dynamic slot a voice browser could fill inside the system prompt", () => {
    expect(pubPalAgentSystemPrompt(PAL_VOICE_MAX_SESSION_SECONDS)).not.toContain("{{");
  });

  it("keeps get-home prompt strings free of jokes, em dashes, and exclamation marks", () => {
    const strings = [
      PAL_VOICE_GET_HOME_REGISTER_INTRO,
      ...PAL_VOICE_GET_HOME_REGISTER_RULES,
      PAL_VOICE_PROPOSE_THEN_CONFIRM_RULE,
      PAL_VOICE_PRE_TOOL_LINE_RULE,
      PAL_VOICE_RECALL_MEMORIES_RULE,
      PAL_VOICE_PROPOSE_MEMORY_RULE,
      PAL_VOICE_SESSION_SUMMARY_RULE,
    ];
    for (const line of strings) {
      expect(line).not.toMatch(/!/);
      expect(line).not.toMatch(/—/);
      expect(line).not.toMatch(/\blol\b/i);
      expect(line).not.toMatch(/\bha ha\b/i);
    }
  });
});
