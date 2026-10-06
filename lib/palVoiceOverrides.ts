import { resolveElevenLabsVoiceIdForPal } from "@/lib/palElevenLabsVoice";
import type { PubPal } from "@/lib/pubPal";

export {
  PAL_VOICE_GET_HOME_REGISTER_INTRO,
  PAL_VOICE_GET_HOME_REGISTER_RULES,
  PAL_VOICE_PROPOSE_MEMORY_RULE,
  PAL_VOICE_PROPOSE_THEN_CONFIRM_RULE,
  PAL_VOICE_RECALL_MEMORIES_RULE,
  PAL_VOICE_SESSION_SUMMARY_RULE,
} from "@/lib/palVoicePrompt.mjs";

/** Persona reaches voice as the greeting and the voice id. Neither touches the system prompt. */
export type PalVoiceOverrides = {
  voiceId: string | null;
  firstMessage: string;
};

export function buildPalVoiceOverrides(pal: PubPal): PalVoiceOverrides {
  return {
    voiceId: resolveElevenLabsVoiceIdForPal(pal),
    firstMessage: `Hi, I'm ${pal.name}. What kind of night are you planning?`,
  };
}
