import type { TavilyLaneResult, TavilyLaneTarget } from "./tavilyLane.mjs";

export function persistTavilyRows(
  files: string[],
  targets: TavilyLaneTarget[],
  outcomes: TavilyLaneResult[],
  observedAt: string,
): number;
