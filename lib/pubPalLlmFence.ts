// Register fence for Pub Pal Custom LLM: get-home and sobriety topics never
// receive freestyle model prose. Grounded Ask tools may supply last-train and
// journey facts; the pal never assesses sobriety or nudges another drink.

import { systemOne } from "@/lib/ai/typesafe.server";
import {
  PUB_PAL_FENCE_QUESTION_IDS,
  PUB_PAL_FENCE_QUESTIONS,
} from "@/lib/pubPalLlmFenceQuestions";

const PUB_PAL_GET_HOME_SOBRIETY_RE =
  /\b(?:get(?:ting)?\s+home|last\s+train|heading\s+home|should\s+i\s+have\s+(?:one\s+)?more|one\s+more\s+(?:drink|pint)|am\s+i\s+(?:okay|ok|fine|sober|drunk)|sobri(?:ety|ous)|drunk\s+enough|fit\s+to\s+drive|driv(?:e|ing)\s+home|uber\s+home|taxi\s+home|way\s+home|how\s+(?:do|can)\s+i\s+get\s+home)\b/i;

const PUB_PAL_SOBRIETY_ONLY_RE =
  /\b(?:should\s+i\s+have\s+(?:one\s+)?more|one\s+more\s+(?:drink|pint)|am\s+i\s+(?:okay|ok|fine|sober|drunk)|sobri(?:ety|ous)|drunk\s+enough|fit\s+to\s+drive)\b/i;

const ALCOHOL_RE = /\b(?:alcohol|drinks?|drinking|drunk|pints?|beers?|wine|cider|spirits?)\b/i;
const VEHICLE_OPERATION_RE = /\b(?:driv(?:e|ing)|cycl(?:e|ing)|rid(?:e|ing)\s+(?:(?:my|a|the)\s+)?(?:bike|motorbike|motorcycle|scooter|e[- ]?bike))\b/i;
const PERSONAL_ALLOWANCE_RE = /\b(?:how\s+(?:many|much|long)|(?:can|could|may|should)\s+(?:i|we)\s+(?:have|drink|consume|drive|cycle|ride))\b/i;
const PERSONAL_OPERATION_QUESTION_RE = /\b(?:can|could|may|should)\s+(?:i|we)\s+(?:drive|cycle|ride\s+(?:(?:my|a|the)\s+)?(?:bike|motorbike|motorcycle|scooter|e[- ]?bike))\b/i;
const PERSONAL_FITNESS_RE = /\b(?:(?:am\s+i|(?:is|would)\s+it(?:\s+be)?|(?:will|would)\s+i\s+be)\s+(?:safe|fit|sober|drunk|okay|ok)|(?:safe|fit|sober|drunk|okay|ok)\s+(?:enough\s+)?to\s+(?:drive|cycle|ride))\b/i;
const ALCOHOL_ALLOWANCE_RE = /\b(?:is|are)\s+(?:one|two|three|a|an|\d+(?:\.\d+)?)\s+(?:pints?|beers?|drinks?|wine|cider)\s+(?:okay|ok|safe)\b/i;

function withoutAlcoholFreeDrinks(message: string): string {
  return message.replace(
    /\b(?:(drink(?:ing)?|drunk|consum(?:e|ing))\s+(?:only\s+)?(?:(?:one|two|three|a|an|\d+(?:\.\d+)?)\s+)?)?(?:alcohol[-\s]+free|non[-\s]*alcoholic|zero[-\s]+alcohol|0(?:[.,]0)?%)\s+(?:beers?|pints?|drinks?|wine|cider|spirits?)\b/gi,
    (_match, verb: string | undefined) => {
      if (!verb) return "soft beverage";
      const consumption = /ing$/i.test(verb) ? "consuming" : /^drunk$/i.test(verb) ? "consumed" : "consume";
      return `${consumption} soft beverage`;
    },
  );
}

function asksAboutAlcoholAndVehicleFitness(message: string): boolean {
  return withoutAlcoholFreeDrinks(message)
    .split(/[!?;]+|(?<!\b(?:[a-z]|st|mr|mrs|ms|dr|prof|jr|sr|vs|etc))\.(?=\s|$)/i)
    .some((text) => {
      if (!ALCOHOL_RE.test(text) || !VEHICLE_OPERATION_RE.test(text)) return false;
      if (ALCOHOL_ALLOWANCE_RE.test(text)) return true;
      const allowanceText = text.replace(
        /\bwhere\s+(?:can|could|may|should)\s+(?:i|we)\s+(?:buy|find|get|have|drink)\b/gi,
        "",
      );
      if (!PERSONAL_ALLOWANCE_RE.test(allowanceText) && !PERSONAL_FITNESS_RE.test(text)) return false;

      const parts = text.split(/\b(before|after|and\s+still)\b/i);
      for (let index = 1; index < parts.length; index += 2) {
        const relation = parts[index] ?? "";
        const left = parts.slice(0, index).join("");
        const right = parts[index + 1] ?? "";
        const remaining = parts.slice(index + 1).join("");
        const alcoholAt = remaining.search(ALCOHOL_RE);
        const operationAt = remaining.search(VEHICLE_OPERATION_RE);
        if (/^before$/i.test(relation) && VEHICLE_OPERATION_RE.test(right)
          && (ALCOHOL_RE.test(left) || alcoholAt > operationAt)) return true;
        if (/^after$/i.test(relation) && ALCOHOL_RE.test(right)
          && (VEHICLE_OPERATION_RE.test(left) || operationAt > alcoholAt)) return true;
        if (/^and\s+still$/i.test(relation)
          && ALCOHOL_RE.test(left) && VEHICLE_OPERATION_RE.test(right)) return true;
      }
      return false;
    });
}

const PUB_PAL_GET_HOME_REGISTER_CLOSER =
  "Open Getting Home on the venue sheet for last-train times, ride links, and the TfL planner.";

const PUB_PAL_SOBRIETY_REGISTER =
  "I can't tell you whether to have another drink.";

export type PubPalFenceTurn = {
  role: "user" | "assistant";
  content: string;
};

export type PubPalFenceIntent = {
  fenced: boolean;
  sobrietyOnly: boolean;
};

/** Direct get-home and alcohol-allowance vocabulary; resolution also routes neutral personal questions. */
export function isPubPalGetHomeOrSobrietyIntent(text: string): boolean {
  const trimmed = text.trim();
  return PUB_PAL_GET_HOME_SOBRIETY_RE.test(trimmed) || asksAboutAlcoholAndVehicleFitness(trimmed);
}

/** Direct get-home and alcohol-allowance vocabulary; resolution also routes neutral personal questions. */
export function isPubPalSobrietyOnlyIntent(text: string): boolean {
  const trimmed = text.trim();
  if (PUB_PAL_GET_HOME_SOBRIETY_RE.test(trimmed)) return PUB_PAL_SOBRIETY_ONLY_RE.test(trimmed);
  return asksAboutAlcoholAndVehicleFitness(trimmed);
}

export function regexFenceIntent(
  message: string,
  recentTurns: PubPalFenceTurn[] = [],
): PubPalFenceIntent {
  const texts = [
    message.trim(),
    ...recentTurns
      .filter((turn) => turn.role === "user")
      .map((turn) => turn.content.trim())
      .filter(Boolean),
  ];
  let sobrietyOnly = false;
  for (const trimmed of texts) {
    if (!isPubPalGetHomeOrSobrietyIntent(trimmed)) continue;
    if (!isPubPalSobrietyOnlyIntent(trimmed)) {
      return { fenced: true, sobrietyOnly: false };
    }
    sobrietyOnly = true;
  }
  const asksFitness = PERSONAL_FITNESS_RE.test(message);
  const asksPersonalVehicleFitness = PERSONAL_OPERATION_QUESTION_RE.test(message)
    || (asksFitness && VEHICLE_OPERATION_RE.test(message));
  if (sobrietyOnly) {
    return { fenced: true, sobrietyOnly: true };
  }
  if (asksPersonalVehicleFitness) {
    return { fenced: true, sobrietyOnly: false };
  }
  return { fenced: false, sobrietyOnly: false };
}

// Threshold from __tests__/fixtures/typesafe/pubPalFenceProbabilities.json (low bar: FN is harm).
export const PUB_PAL_FENCE_NOUL_THRESHOLD = 0.33;

export function pubPalFenceFromNouls(
  fitToTravel: number,
  getHome: number,
): PubPalFenceIntent {
  const fitnessHit = fitToTravel >= PUB_PAL_FENCE_NOUL_THRESHOLD;
  const getHomeHit = getHome >= PUB_PAL_FENCE_NOUL_THRESHOLD;
  if (!fitnessHit && !getHomeHit) {
    return { fenced: false, sobrietyOnly: false };
  }
  return {
    fenced: true,
    sobrietyOnly: fitnessHit && !getHomeHit,
  };
}

/** TypeSafe when keyed; regex table when keyless or the judgment call fails. */
export async function resolvePubPalFenceIntent(
  message: string,
  recentTurns: PubPalFenceTurn[] = [],
): Promise<PubPalFenceIntent> {
  const trimmed = message.trim();
  if (!trimmed) return { fenced: false, sobrietyOnly: false };

  const response = await systemOne(
    // Typed chat combines six browser turns with six owned turns in one classification.
    { message: trimmed, recentTurns: recentTurns.filter((turn) => turn.role === "user").slice(-12) },
    PUB_PAL_FENCE_QUESTIONS,
    { lane: "typesafe", timeoutMs: 4_000 },
  );

  if (!response) {
    return regexFenceIntent(trimmed, recentTurns);
  }

  const fit =
    response.answers[PUB_PAL_FENCE_QUESTION_IDS.fitToTravelAfterDrinking].noul;
  const home = response.answers[PUB_PAL_FENCE_QUESTION_IDS.getHomeTonight].noul;
  const typesafeIntent = pubPalFenceFromNouls(fit, home);

  if (typesafeIntent.fenced) {
    return typesafeIntent;
  }

  return regexFenceIntent(trimmed, recentTurns);
}

/** Compose a plain register answer from grounded tool hints only. */
export function pubPalGetHomeRegisterAnswer(
  groundedAnswer: string,
  sobrietyOnly: boolean,
): string {
  if (sobrietyOnly) {
    const fact = groundedAnswer.trim();
    if (fact && !/(?:cannot|can't) tell you whether to have another drink/i.test(fact)) {
      return `${PUB_PAL_SOBRIETY_REGISTER} ${fact} ${PUB_PAL_GET_HOME_REGISTER_CLOSER}`;
    }
    return `${PUB_PAL_SOBRIETY_REGISTER} ${PUB_PAL_GET_HOME_REGISTER_CLOSER}`;
  }

  const fact = groundedAnswer.trim();
  if (!fact) {
    return PUB_PAL_GET_HOME_REGISTER_CLOSER;
  }
  return `${fact} ${PUB_PAL_GET_HOME_REGISTER_CLOSER}`;
}
