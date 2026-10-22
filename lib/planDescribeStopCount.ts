import { inferPlanStopCount, type PlanStopCount } from "@/lib/planStopCount";
import { cleanText } from "@/lib/textClean";

/** One vocabulary for stated group sizes and requested pub stops. */
export const PLAN_QUERY_NUMBER_WORDS: Readonly<Record<string, number>> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
};

/** Read only the requested stop count, with the full planner's text boundary. */
export function inferDescribeStopCount(rawQuery: unknown): PlanStopCount {
  return inferPlanStopCount(cleanText(rawQuery, 500).toLocaleLowerCase(), PLAN_QUERY_NUMBER_WORDS);
}
