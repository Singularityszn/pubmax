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
const VEHICLE_OPERATION_RE = /\b(?:driv(?:e|ing)|cycl(?:e|ing)|rid(?:e|ing)\s+(?:(?:my|a|the)\s+)?bike)\b/i;
const PERSONAL_ALLOWANCE_RE = /\b(?:how\s+(?:many|much|long)|(?:can|could|may|should)\s+i)\b/i;

function asksAboutAlcoholAndVehicleFitness(message: string): boolean {
  const text = message.replace(
    /\b(?:alcohol[-\s]+free|non[-\s]*alcoholic|zero[-\s]+alcohol|0(?:[.,]0)?%)\s+(?:beers?|pints?|drinks?|wine|cider|spirits?)\b/gi,
    "",
  );
  const alcoholAt = text.search(ALCOHOL_RE);
  const operationAt = text.search(VEHICLE_OPERATION_RE);
  if (alcoholAt < 0 || operationAt < 0) return false;
  if (/\b(?:safe|fit|sober|drunk|okay|ok)\b/i.test(text)) return true;
  if (!PERSONAL_ALLOWANCE_RE.test(text)) return false;

  const beforeAt = text.search(/\bbefore\b/i);
  const afterAt = text.search(/\bafter\b/i);
  const stillAt = text.search(/\band\s+still\b/i);
  const alcoholBeforeOperation = beforeAt >= 0 && operationAt > beforeAt
    && (alcoholAt < beforeAt || operationAt < alcoholAt);
  const operationAfterAlcohol = afterAt >= 0 && alcoholAt > afterAt
    && (operationAt < afterAt || operationAt > alcoholAt);
  return alcoholBeforeOperation || operationAfterAlcohol || (stillAt >= 0 && operationAt > stillAt);
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

/** Deterministic keyless fallback. */
export function isPubPalGetHomeOrSobrietyIntent(text: string): boolean {
  const trimmed = text.trim();
  return PUB_PAL_GET_HOME_SOBRIETY_RE.test(trimmed) || asksAboutAlcoholAndVehicleFitness(trimmed);
}

/** Deterministic keyless fallback. */
export function isPubPalSobrietyOnlyIntent(text: string): boolean {
  const trimmed = text.trim();
  if (PUB_PAL_GET_HOME_SOBRIETY_RE.test(trimmed)) return PUB_PAL_SOBRIETY_ONLY_RE.test(trimmed);
  return asksAboutAlcoholAndVehicleFitness(trimmed);
}

function regexFenceIntent(
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
  if (sobrietyOnly) {
    return { fenced: true, sobrietyOnly: true };
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
    { message: trimmed, recentTurns: recentTurns.slice(-6) },
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
