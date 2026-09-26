import type { AskRouterModelEvalCase } from "./loadCases";

function allowedTools(caseDef: AskRouterModelEvalCase): string[] {
  return caseDef.expectedTools ?? [caseDef.expectedTool];
}

/** Headline grade: the model's first tool call must be an expected tool. */
export function firstToolMatchesCase(
  pickedTools: string[],
  caseDef: AskRouterModelEvalCase,
): boolean {
  const first = pickedTools[0];
  return first !== undefined && allowedTools(caseDef).includes(first);
}

/** Lenient grade: any of the picked tools is an expected tool. */
export function anyToolMatchesCase(
  pickedTools: string[],
  caseDef: AskRouterModelEvalCase,
): boolean {
  const allowed = allowedTools(caseDef);
  return pickedTools.some((tool) => allowed.includes(tool));
}
