import { inferDescribeStopCount } from "@/lib/planDescribeStopCount";
import type { PlanStopCount } from "@/lib/planStopCount";

/** Preserve typed text and explicit counts when an empty-field chip is offered. */
export function resolveDescribeChipSubmit(input: {
  query: string;
  stopCountTouched: boolean;
  stopCount: PlanStopCount;
  chipText: string;
  chipInferredStopCount: PlanStopCount;
}): { query: string; stopCount: PlanStopCount } {
  const userQuery = input.query.trim();
  const query = userQuery || input.chipText;
  const typedStopCount = userQuery
    ? inferDescribeStopCount(userQuery)
    : input.chipInferredStopCount;
  const stopCount = input.stopCountTouched ? input.stopCount : typedStopCount;
  return { query, stopCount };
}
