// Ask-router TypeSafe policy: probability validation, floors, and the
// judged-vs-regex publish rule. Thresholds come from
// __tests__/fixtures/typesafe/ask-router-probabilities.json

import { isAskToolName, type AskToolName } from "@/lib/ask/types";

export const ASK_ROUTER_NONE = "none";

/**
 * Floor on the winning tool's probability AND confidence.
 * Chosen from __tests__/fixtures/typesafe/ask-router-probabilities.json:
 * above the low-confidence agreements (buzz-soho, cheapest-around-lamb,
 * get-me-to-lamb), which stay on the regex route, and below the two
 * high-confidence disagreements the run recorded (drink-prices-camden,
 * cocktail-price-lamb).
 */
export const ASK_ROUTER_TOOL_FLOOR = 0.6;

/** Speculative Noul: only consumed when the chosen tool is propose_map_action. */
export const ASK_ROUTER_WANTS_MAP_FLOOR = 0.55;

export const ASK_ROUTER_VENUE_CANDIDATE_CAP = 12;

export type AskRouterDropReason =
  | "no_key"
  | "budget"
  | "timeout"
  | "error"
  | "malformed-answer"
  | "below-floor"
  | "chose-none";

export type AskRouterJudgment = {
  tool: string;
  toolProbability: number;
  toolConfidence: number;
  venue: string;
  venueProbability: number;
  venueConfidence: number;
  area: string;
  areaProbability: number;
  areaConfidence: number;
  wantsMap: number;
};

/**
 * A judged answer is only a probability when it is a real number in [0, 1].
 * `"0.95"`, `95` and `true` all satisfy `>= 0.6` under JavaScript coercion, so
 * a malformed body must never reach a comparison.
 */
export function isAskRouterProbability(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function readChoice(answer: unknown): {
  choice: string;
  probability: number;
  confidence: number;
} | null {
  if (!answer || typeof answer !== "object" || Array.isArray(answer)) return null;
  const record = answer as Record<string, unknown>;
  if (typeof record.choice !== "string" || !record.choice) return null;
  if (!isAskRouterProbability(record.confidence)) return null;
  const probabilities = record.probabilities;
  if (!probabilities || typeof probabilities !== "object" || Array.isArray(probabilities)) {
    return null;
  }
  const probability = (probabilities as Record<string, unknown>)[record.choice];
  if (!isAskRouterProbability(probability)) return null;
  return { choice: record.choice, probability, confidence: record.confidence };
}

function readNoul(answer: unknown): number | null {
  if (!answer || typeof answer !== "object" || Array.isArray(answer)) return null;
  const noul = (answer as Record<string, unknown>).noul;
  return isAskRouterProbability(noul) ? noul : null;
}

/** Pull a typed judgment out of a System One answer map, or null if malformed. */
export function parseAskRouterJudgment(answers: unknown): AskRouterJudgment | null {
  if (!answers || typeof answers !== "object" || Array.isArray(answers)) return null;
  const record = answers as Record<string, unknown>;
  const tool = readChoice(record.tool);
  const venue = readChoice(record.venue);
  const area = readChoice(record.area);
  const wantsMap = readNoul(record.wantsMap);
  if (!tool || !venue || !area || wantsMap === null) return null;
  return {
    tool: tool.choice,
    toolProbability: tool.probability,
    toolConfidence: tool.confidence,
    venue: venue.choice,
    venueProbability: venue.probability,
    venueConfidence: venue.confidence,
    area: area.choice,
    areaProbability: area.probability,
    areaConfidence: area.confidence,
    wantsMap,
  };
}

/**
 * Whether the judged tool may replace the regex route.
 * Never publishes on argmax without the floor. `none` always falls back.
 */
export function judgedToolClearsFloor(judgment: AskRouterJudgment): boolean {
  if (judgment.tool === ASK_ROUTER_NONE) return false;
  if (!isAskToolName(judgment.tool)) return false;
  return (
    judgment.toolProbability >= ASK_ROUTER_TOOL_FLOOR &&
    judgment.toolConfidence >= ASK_ROUTER_TOOL_FLOOR
  );
}

/**
 * Publish the judged tool only when it clears the floor. A gold regex case that
 * Jev would reroute below the floor stays on the regex tool.
 */
export function publishedAskTool(
  judgment: AskRouterJudgment,
  regexTool: AskToolName | undefined,
): AskToolName | null {
  if (!judgedToolClearsFloor(judgment)) return regexTool ?? null;
  return judgment.tool as AskToolName;
}

export function overlayChoiceClearsFloor(probability: number, confidence: number): boolean {
  return probability >= ASK_ROUTER_TOOL_FLOOR && confidence >= ASK_ROUTER_TOOL_FLOOR;
}
