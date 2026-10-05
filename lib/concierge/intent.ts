import { systemOne } from "@/lib/ai/typesafe.server";
import { conciergeIntentQuestions } from "@/lib/concierge/intentQuestions";
import {
  AREA_NONE,
  CHEAP_PINT_GBP,
  DEFAULT_GROUP_SIZE,
  GROUP_UNSTATED,
  NUMBER_WORDS,
  areaCandidatesInText,
  defaultKnownAreas,
  deterministicAreaInText,
  extractExplicitBudget,
  groupSizeCandidatesInText,
  intentFromJudgment,
  moodQuestionId,
  validateJudgedIntent,
} from "@/lib/concierge/intentPolicy";
import {
  CONCIERGE_MOODS,
  type ConciergeIntent,
  type ConciergeMood,
} from "@/lib/concierge/rank";

export type ParsedConciergeIntent = {
  intent: ConciergeIntent;
  source: "model" | "deterministic";
};

type ParseOptions = {
  /**
   * Withhold the paid TypeSafe assist and answer deterministically. Callers set
   * this when paid spend can't be safely rate-limited (e.g. production with
   * no durable limiter) — the parse still works, it just never spends.
   */
  skipModel?: boolean;
  knownAreas?: readonly string[];
};

const MOOD_TERMS: Record<ConciergeMood, RegExp> = {
  balanced: /\b(?:balanced|bit of everything|anything)\b/i,
  quiet: /\b(?:quiet|quiet-ish|calm|chat|low-key)\b/i,
  lively: /\b(?:lively|buzzing|party|atmosphere)\b/i,
  cosy: /\b(?:cosy|cozy|snug|fireside)\b/i,
  garden: /\b(?:garden|outside|outdoor|sunny)\b/i,
  riverside: /\b(?:riverside|river|waterside|by the water)\b/i,
  sports: /\b(?:sport|sports|football|rugby|match)\b/i,
  date: /\b(?:date|romantic)\b/i,
  food: /\b(?:food|dinner|eat|meal)\b/i,
  cocktails: /\b(?:cocktail|cocktails|mixed drinks)\b/i,
  heritage: /\b(?:heritage|historic|history|old pub)\b/i,
};

function deterministicIntent(text: string, knownAreas: readonly string[]): ConciergeIntent {
  const mood = CONCIERGE_MOODS.filter((candidate) => MOOD_TERMS[candidate].test(text));
  const numericGroup = text.match(/\b(\d{1,2})\s+(?:of us|people|mates|pax)\b/i)?.[1]
    ?? text.match(/\b(?:for|group of|we(?:'re| are))\s+(?!£)(\d{1,2})\b/i)?.[1];
  const wordGroup = text.match(/\b(one|two|three|four|five|six|seven|eight|nine|ten|twelve)\s+(?:of us|people|mates|pax)\b/i)?.[1]
    ?? text.match(/\b(?:for|group of|we(?:'re| are))\s+(one|two|three|four|five|six|seven|eight|nine|ten|twelve)\b/i)?.[1];
  const parsedGroup = numericGroup ? Number(numericGroup) : wordGroup ? (NUMBER_WORDS[wordGroup.toLowerCase()] ?? DEFAULT_GROUP_SIZE) : DEFAULT_GROUP_SIZE;
  const groupSize = Math.min(20, Math.max(1, parsedGroup));

  const area = deterministicAreaInText(text, knownAreas);

  const explicitBudget = extractExplicitBudget(text);
  const maxPintPrice = explicitBudget !== undefined
    ? explicitBudget
    : /\b(?:not pricey|cheap|budget|inexpensive|affordable)\b/i.test(text)
      ? CHEAP_PINT_GBP
      : undefined;

  return {
    mood,
    groupSize,
    ...(area ? { area } : {}),
    ...(maxPintPrice !== undefined ? { maxPintPrice } : {}),
  };
}

type ChoiceAnswer = {
  choice?: unknown;
  probabilities?: Record<string, unknown>;
};

function asChoiceAnswer(value: unknown): ChoiceAnswer {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const record = value as Record<string, unknown>;
  const probabilities = record.probabilities;
  return {
    choice: record.choice,
    probabilities:
      probabilities && typeof probabilities === "object" && !Array.isArray(probabilities)
        ? probabilities as Record<string, unknown>
        : undefined,
  };
}

async function typesafeIntent(
  text: string,
  knownAreas: readonly string[],
): Promise<ConciergeIntent | null> {
  const areaCandidates = areaCandidatesInText(text, knownAreas);
  const groupSizeCandidates = groupSizeCandidatesInText(text);
  const questions = conciergeIntentQuestions({
    areaCandidates,
    groupSizeCandidates,
  });
  const response = await systemOne(
    { text, knownAreas: [...knownAreas], moods: [...CONCIERGE_MOODS] },
    questions,
    { lane: "typesafe", timeoutMs: 4_000 },
  );
  if (!response) return null;

  const moods: Partial<Record<ConciergeMood, unknown>> = {};
  for (const mood of CONCIERGE_MOODS) {
    const answered: unknown = response.answers[moodQuestionId(mood)];
    moods[mood] = answered && typeof answered === "object" && "noul" in answered
      ? (answered as { noul: unknown }).noul
      : undefined;
  }
  const areaAnswer = asChoiceAnswer(response.answers.area);
  const groupAnswer = asChoiceAnswer(response.answers.groupSize);
  const budgetAnswer = asChoiceAnswer(response.answers.budgetSignal);

  const composed = intentFromJudgment(text, {
    moods,
    areaChoice: areaAnswer.choice ?? AREA_NONE,
    areaProbabilities: areaAnswer.probabilities,
    groupChoice: groupAnswer.choice ?? GROUP_UNSTATED,
    groupProbabilities: groupAnswer.probabilities,
    budgetChoice: budgetAnswer.choice,
    budgetProbabilities: budgetAnswer.probabilities,
    areaOptions: areaCandidates,
    groupOptions: groupSizeCandidates,
  });
  if (!composed) return null;
  return validateJudgedIntent(composed, text);
}

function typesafeKeyConfigured(): boolean {
  return Boolean(process.env.TYPESAFE_API_KEY?.trim());
}

/** Keyless Playwright servers must never spend on intent, even if `.env.local` carries a key. */
function keylessRuntimeForIntent(): boolean {
  return process.env.PUBMAX_E2E_KEYLESS === "1";
}

function shouldUseDeterministicIntentOnly(options: ParseOptions): boolean {
  if (keylessRuntimeForIntent()) return true;
  if (options.skipModel) return true;
  return !typesafeKeyConfigured();
}

/** Parse intent with a bounded TypeSafe assist and a deterministic, keyless fallback. */
export async function parseConciergeIntent(
  text: string,
  options: ParseOptions = {},
): Promise<ParsedConciergeIntent> {
  const clipped = text.slice(0, 500);
  const knownAreas = options.knownAreas ?? defaultKnownAreas();
  const fallback = deterministicIntent(clipped, knownAreas);
  if (shouldUseDeterministicIntentOnly(options)) {
    return { intent: fallback, source: "deterministic" };
  }
  try {
    const parsed = await typesafeIntent(clipped, knownAreas);
    return parsed
      ? { intent: parsed, source: "model" }
      : { intent: fallback, source: "deterministic" };
  } catch {
    return { intent: fallback, source: "deterministic" };
  }
}
