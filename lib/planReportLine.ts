// The planner's own report, as one quiet line on the plan card.
//
// Week 1 hygiene, captain decision 4: the plan generation response carries
// report lines the plan screen did not print ("Short walks: every leg is under
// 1.2 km.", "Tube: every stop is within 600 m of a station."). These answer a
// word the reader typed, so the card prints them, joined, under the stops.
//
// ONLY THE LINES THAT ANSWER A WORD THE READER SET. The always-on lines
// (safety, exclusions, how travel time is worked out, opening hours) are
// already said where the route is built, and printing them on every card would
// bury the two a reader asked for. A code absent from the response prints
// nothing: this module never writes a line of its own.
//
// THE LINE TRAVELS WITH THE LOCK. The report is not stored on the Plan, so the
// composer hands it to the card on the device that built the route, keyed by
// the new plan id. Another device, or a plan built before this shipped, has no
// line and the card prints none.

/** The report codes the card prints, in this order. */
export const PLAN_REPORT_LINE_CODES = ["short_walks", "tube_stations", "exact_area"] as const;

const STORAGE_PREFIX = "pubmax:plan-report-line:";
const LINE_MAX = 400;

/**
 * The one line for a generation response's `constraintReport`, or null when it
 * carries none of the printed codes.
 */
export function planReportLine(report: unknown): string | null {
  if (!report || typeof report !== "object") return null;
  const hard = (report as { hardConstraints?: unknown }).hardConstraints;
  if (!Array.isArray(hard)) return null;
  const messages: string[] = [];
  for (const code of PLAN_REPORT_LINE_CODES) {
    const row = hard.find(
      (candidate): candidate is { code: string; message: string } =>
        Boolean(candidate)
        && typeof candidate === "object"
        && (candidate as { code?: unknown }).code === code
        && typeof (candidate as { message?: unknown }).message === "string",
    );
    const message = row?.message.trim();
    if (message) messages.push(message);
  }
  if (!messages.length) return null;
  return messages.join(" ").slice(0, LINE_MAX);
}

/** Keep a plan's report line on this device, for its card to print. */
export function rememberPlanReportLine(planId: string, line: string | null): void {
  try {
    if (line) window.localStorage.setItem(`${STORAGE_PREFIX}${planId}`, line.slice(0, LINE_MAX));
    else window.localStorage.removeItem(`${STORAGE_PREFIX}${planId}`);
  } catch {
    // Storage blocked or full: the card prints no line, which is the honest default.
  }
}

/** The report line this device kept for a plan, or null. */
export function readPlanReportLine(planId: string): string | null {
  try {
    const value = window.localStorage.getItem(`${STORAGE_PREFIX}${planId}`);
    return value && value.trim() ? value.slice(0, LINE_MAX) : null;
  } catch {
    return null;
  }
}
