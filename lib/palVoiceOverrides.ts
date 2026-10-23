import { resolveElevenLabsVoiceForPal, type PalVoiceSelection } from "@/lib/palElevenLabsVoice";
import type { PubPal } from "@/lib/pubPal";
import { palOpeningMessage, type PalOpeningContext } from "@/lib/palOpening";

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
  /** Presentation metadata only. Older grants can omit it. */
  voiceSource?: PalVoiceSelection["voiceSource"];
  firstMessage: string;
};

export function buildPalVoiceOverrides(pal: PubPal, context?: { taste: import("@/lib/palTaste").PalTaste | null; memories?: PalOpeningContext["memories"] }): PalVoiceOverrides {
  return {
    ...resolveElevenLabsVoiceForPal(pal),
    firstMessage: palOpeningMessage(pal.name, context ? { ...context, memories: context.memories === undefined ? [] : context.memories } : undefined),
  };
}
