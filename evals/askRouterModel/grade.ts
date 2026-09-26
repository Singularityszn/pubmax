import type { AskRouterModelEvalCase } from "./loadCases";

export function toolChoiceMatchesCase(
  pickedTools: string[],
  caseDef: AskRouterModelEvalCase,
): boolean {
  if (pickedTools.length === 0) return false;
  const allowed = caseDef.expectedTools ?? [caseDef.expectedTool];
  return pickedTools.some((tool) => allowed.includes(tool));
}
