import { resolveElevenLabsVoiceForPal, type PalVoiceSelection } from "@/lib/palElevenLabsVoice";
import type { PubPal } from "@/lib/pubPal";
import type { PalTaste } from "@/lib/palTaste";

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

type GreetingContext = { taste: PalTaste | null };

function firstMessageFor(pal: PubPal, context?: GreetingContext): string {
  const hello = `Hi, I'm ${pal.name}.`;
  const visit = context?.taste?.lastVisit;
  if (visit?.name) {
    const date = new Date(`${visit.on}T12:00:00Z`);
    const day = Number.isFinite(date.getTime()) ? ` on ${date.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })}` : "";
    const pint = visit.recordedPints?.[0];
    const price = pint ? `, with ${pint.drink} at £${pint.priceGbp.toFixed(2)} a pint` : "";
    return `${hello} Last time, you logged ${visit.name}${day}${price}. Something similar tonight?`;
  }
  if (context?.taste?.declaredDrink) return `${hello} Your profile says "${context.taste.declaredDrink}". Something along those lines tonight?`;
  return `${hello} What kind of night are you planning?`;
}

export function buildPalVoiceOverrides(pal: PubPal, context?: GreetingContext): PalVoiceOverrides {
  return {
    ...resolveElevenLabsVoiceForPal(pal),
    firstMessage: firstMessageFor(pal, context),
  };
}
