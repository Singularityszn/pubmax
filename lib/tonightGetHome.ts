// Tonight "get home" strip summary — one calm line pair for the /tonight page.
//
// Pure reduction of the existing /api/last-train answer (lib/tfl.ts shapes) to
// the two short sentences the strip renders. No fetch, no clock of its own
// (callers pass `now`), so it unit-tests without mocks. Tone rules match the
// Last Pint card: state the fact and stop, never invent a time, never alarm.

import { clockMinutes } from "@/lib/clock";
import {
  describeLeaveCountdown,
  minutesUntilLeaveBy,
  type LastTrain,
  type LastTrainResult,
} from "@/lib/tfl";
import { lineDisplayLabel } from "@/lib/tflDisruption";

/**
 * A last train's place in its SERVICE day, in minutes: 00:28 on the Friday
 * timetable is 24:28, so 1468, and sorts after 23:50 (1430). A plain "HH:MM"
 * string compare puts "00:15" before "23:50", which is the wrong way round.
 * TfL's original `serviceHour` (hour >= 24 after midnight) wins when present;
 * otherwise `pastMidnight` adds the day.
 */
export function lastTrainServiceRank(
  train: Pick<LastTrain, "clock" | "pastMidnight" | "serviceHour">,
): number {
  const clock = clockMinutes(train.clock);
  if (typeof train.serviceHour === "number" && Number.isFinite(clock)) {
    return train.serviceHour * 60 + (clock % 60);
  }
  return clock + (train.pastMidnight ? 24 * 60 : 0);
}

/**
 * The latest last train across serving lines: the one any line home hangs on,
 * and the one the route's leave-by decision is computed from. Null when there
 * are no trains.
 */
export function latestLastTrain<T extends Pick<LastTrain, "clock" | "pastMidnight" | "serviceHour">>(
  trains: readonly T[] | undefined,
): T | null {
  let latest: T | null = null;
  for (const train of trains ?? []) {
    if (latest === null || lastTrainServiceRank(train) > lastTrainServiceRank(latest)) {
      latest = train;
    }
  }
  return latest;
}

export type GetHomeSummary = {
  // "Victoria line good service." or a short disruption note.
  statusLine: string;
  // "Last train from Oxford Circus 00:05." (with leave-by countdown when close)
  trainLine: string;
};

// TfL disruption summaries can run long; the strip is one calm line, not a
// service bulletin. Cut on a word boundary and mark the cut honestly.
const DISRUPTION_MAX = 90;

function truncate(text: string): string {
  if (text.length <= DISRUPTION_MAX) return text;
  const cut = text.slice(0, DISRUPTION_MAX);
  const lastSpace = cut.lastIndexOf(" ");
  return `${cut.slice(0, lastSpace > 40 ? lastSpace : DISRUPTION_MAX).trimEnd()}…`;
}

/**
 * Reduce a LastTrainResult to the strip's two lines, or null when there is
 * nothing worth saying (no station, or no train times at all) — the strip
 * renders nothing rather than an empty shell.
 */
export function summariseGetHome(
  result: LastTrainResult,
  now: Date = new Date(),
): GetHomeSummary | null {
  // The route's graceful-failure shape is 200 + `error` + empty body, so both
  // station and trains must be defensively checked, not assumed.
  const stationName = result.station?.name;
  if (
    !stationName ||
    !Array.isArray(result.trains) ||
    result.trains.length === 0
  ) {
    return null;
  }

  // Anchor fact: the latest last train from the station across serving lines,
  // ranked in the service-day frame so a past-midnight 00:28 beats 23:50.
  const lastTrain = latestLastTrain(result.trains);
  if (!lastTrain) return null;

  // The decision's lines are the ones that matter for getting home; fall back
  // to the latest-running line when the decision is absent.
  const decision = result.decision ?? null;
  const primaryLineName =
    decision?.lineNames[0] ?? lastTrain.lineName;

  const disruption = decision?.disruptionSummary ?? null;
  const statusLine = disruption
    ? truncate(disruption)
    : `${lineDisplayLabel(primaryLineName)} good service.`;

  let trainLine = `Last train from ${stationName} ${lastTrain.clock}.`;
  const countdown = describeLeaveCountdown(
    minutesUntilLeaveBy(decision?.leaveByIso ?? null, now),
  );
  if (countdown === "leave-by time has passed") {
    // Grammar guard: this phrasing is a sentence of its own, not "Leave <x>".
    trainLine = `${trainLine} Leave-by time has passed.`;
  } else if (countdown) {
    trainLine = `${trainLine} Leave ${countdown}.`;
  }
  return { statusLine, trainLine };
}
