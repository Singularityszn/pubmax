import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PAL_RECALL_MEMORIES_TOOL } from "@/lib/palConfirmedMemories.server";
import { PAL_PROPOSE_MEMORY_TOOL } from "@/lib/palMemoryProposal.server";
import { PAL_VOICE_MAX_SESSION_SECONDS } from "@/lib/palVoiceMetering";
import { PAL_MAP_CLIENT_TOOL_NAMES } from "@/lib/palMapClientTools.mjs";
import {
  PAL_VOICE_BEST_MATE_RULE,
  PAL_VOICE_PRE_TOOL_LINE_RULE,
  PAL_VOICE_QUICK_PICK_OR_PLAN_RULE,
  PAL_VOICE_TASTE_RULE,
  pubPalAgentSystemPrompt,
  pubPalTypedChatSystemPrompt,
} from "@/lib/palVoicePrompt.mjs";
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
    expect(Object.keys(overrides).sort()).toEqual(["firstMessage", "pickedVoiceMissing", "voiceId", "voiceSource"]);
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

  it("talks like a best mate who knows their taste, and picks or plans by the ask", () => {
    const prompt = pubPalAgentSystemPrompt(PAL_VOICE_MAX_SESSION_SECONDS);
    for (const rule of [PAL_VOICE_BEST_MATE_RULE, PAL_VOICE_TASTE_RULE, PAL_VOICE_QUICK_PICK_OR_PLAN_RULE]) {
      expect(prompt).toContain(rule);
      expect(rule).not.toMatch(/[!\u2014]/);
    }
    expect(PAL_VOICE_TASTE_RULE).toMatch(/never as a fact about a pub/);
    expect(PAL_VOICE_QUICK_PICK_OR_PLAN_RULE).toContain("propose_plan");
    expect(agentConfig.toolNames).toContain("propose_plan");
    // The Safe Night register still wins over the warmer one.
    expect(prompt.indexOf(PAL_VOICE_GET_HOME_REGISTER_INTRO)).toBeGreaterThan(prompt.indexOf(PAL_VOICE_BEST_MATE_RULE));
  });

  it("gives voice, and only voice, the short-answer rule and the map tools it is given", () => {
    const voice = pubPalAgentSystemPrompt(PAL_VOICE_MAX_SESSION_SECONDS);
    const typed = pubPalTypedChatSystemPrompt();
    // The step 7 clauses, written out here rather than read from the rule constants.
    for (const clause of ["say at most two names and one price", "then say the rest are on the map", "under 25 words unless the person asked for a plan"]) {
      expect(voice).toContain(clause);
      expect(typed).not.toContain(clause);
    }
    for (const tool of PAL_MAP_CLIENT_TOOL_NAMES) {
      expect(voice).toContain(tool);
      expect(typed).not.toContain(tool);
    }
  });

  it("plans a typed crawl that names its area at once, and leaves voice its questions", () => {
    const voice = pubPalAgentSystemPrompt(PAL_VOICE_MAX_SESSION_SECONDS);
    const typed = pubPalTypedChatSystemPrompt();
    // A typed reply that only asks questions shows no plan card.
    const voiceQuestions = "ask up to three short questions about only what their taste and the ask leave open";
    const typedPlan = "When a plan ask names an area, call propose_plan now and do not ask a question first.";
    expect(voice).toContain(voiceQuestions);
    expect(voice).not.toContain(typedPlan);
    expect(typed).toContain(typedPlan);
    expect(typed).not.toContain(voiceQuestions);
    for (const line of typed.split("\n")) expect(line).not.toMatch(/[!—]/);
  });

  it("gives voice, and only voice, the rules that keep a call from going quiet or nagging", () => {
    const voice = pubPalAgentSystemPrompt(PAL_VOICE_MAX_SESSION_SECONDS);
    const typed = pubPalTypedChatSystemPrompt();
    // The branch-tested clauses, written out here rather than read from the rule constants.
    for (const clause of [
      "After a tool returns, say the answer in the same turn. Never wait for the person to speak first.",
      "check in once with a short line, such as: Still there?",
      "If they stay quiet after that check-in, say one short goodbye",
      "say one short goodbye and then call end_call. Never end the call while they are still asking.",
      `The app ends the call at ${PAL_VOICE_MAX_SESSION_SECONDS} seconds.`,
    ]) {
      expect(voice).toContain(clause);
      expect(typed).not.toContain(clause);
    }
    expect(typed).not.toContain("end_call");
    // The old line told the agent to end a call it had no tool to end.
    expect(voice).not.toContain("End the call once it reaches");
    for (const line of voice.split("\n")) expect(line).not.toMatch(/[!\u2014]/);
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
