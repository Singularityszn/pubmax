// Crowd occupancy (master plan R-011). Pure + browser-safe.
//
// A crowd report is a NOW reading about seats: Empty / Some seats / Full.
// A Visit Report is a remembered night (quiet / steady / rammed). They are
// the same three-point scale in two tenses, so this module owns the mapping
// and never invents a fourth word. Trust is derived on READ: only reports
// inside 90 minutes may answer "now", and the age is printed. Older rows stay
// for the forecast (R-012) and never paint a now surface.

import {
  BUSYNESS_VALUES,
  type Busyness,
} from "@/lib/visitReports";

/** The closed set a person may report. Master plan R-011's three buttons. */
export const OCCUPANCY_LEVELS = ["empty", "some-seats", "full"] as const;

export type OccupancyLevel = (typeof OCCUPANCY_LEVELS)[number];

export const OCCUPANCY_LEVEL_LABELS: Record<OccupancyLevel, string> = {
  empty: "Empty",
  "some-seats": "Some seats",
  full: "Full",
};

/** A now surface may claim a seat only from a report under 90 minutes old. */
export const OCCUPANCY_FRESH_WINDOW_MS = 90 * 60 * 1000;

/** A re-tap by the same account at the same pub updates, not stacks. */
export const OCCUPANCY_RETAKE_WINDOW_MS = 15 * 60 * 1000;

/**
 * How long a receipt may stand in for the reading. A receipt says "just now"
 * about the tap that made it, so it has to give way to the derived reading
 * rather than freeze a surface on an age that stops being true.
 */
export const OCCUPANCY_RECEIPT_HOLD_MS = 5 * 1000;

export const OCCUPANCY_SOURCE = "crowd" as const;
export type OccupancySource = typeof OCCUPANCY_SOURCE;

/** SQL CHECK values. The wire uses hyphens; the table uses underscores. */
export const OCCUPANCY_SQL_LEVELS = ["empty", "some_seats", "full"] as const;
export type OccupancySqlLevel = (typeof OCCUPANCY_SQL_LEVELS)[number];

export function occupancyLevelToSql(level: OccupancyLevel): OccupancySqlLevel {
  return level === "some-seats" ? "some_seats" : level;
}

const BUSYNESS_BY_LEVEL: Record<OccupancyLevel, Busyness> = {
  empty: "quiet",
  "some-seats": "steady",
  full: "rammed",
};

const LEVEL_BY_BUSYNESS: Record<Busyness, OccupancyLevel> = {
  quiet: "empty",
  steady: "some-seats",
  rammed: "full",
};

export function occupancyToBusyness(level: OccupancyLevel): Busyness {
  return BUSYNESS_BY_LEVEL[level];
}

export function occupancyFromBusyness(busyness: Busyness): OccupancyLevel {
  return LEVEL_BY_BUSYNESS[busyness];
}

export function parseOccupancyLevel(value: unknown): OccupancyLevel | null {
  if (typeof value !== "string") return null;
  const needle = value.trim().toLowerCase().replace(/[\s_]+/g, "-");
  if ((OCCUPANCY_LEVELS as readonly string[]).includes(needle)) {
    return needle as OccupancyLevel;
  }
  if ((BUSYNESS_VALUES as readonly string[]).includes(needle)) {
    return occupancyFromBusyness(needle as Busyness);
  }
  // The negatives are read BEFORE the bare "seats" alternative below, or
  // "no seats" (which the router itself triggers on) reads as some seats.
  if (/\bno-(?:seats?|room|space|tables?)\b/.test(needle)) return "full";
  if (/\b(rammed|packed|heaving)\b/.test(needle)) return "full";
  if (/\b(quiet|dead|empty)\b/.test(needle)) return "empty";
  if (/\b(seats|room|space)\b/.test(needle)) return "some-seats";
  return null;
}

export function occupancyLevelFromSql(value: unknown): OccupancyLevel | null {
  return parseOccupancyLevel(value);
}

export type OccupancyReport = {
  venueId: string;
  level: OccupancyLevel;
  reportedAt: string;
  reporterUserId: string;
  source: OccupancySource;
};

export type OccupancyNowAnswer = {
  now: OccupancyLevel | null;
  ageMinutes: number | null;
  reportsLast90: number;
  degraded: boolean;
  /** Derived on read. Older rows feed the forecast later; they never paint now. */
  state: OccupancyReadState;
};

export type OccupancyReadState = "fresh" | "stale" | "none" | "degraded";

export function occupancyAgeMinutes(
  reportedAtMs: number,
  nowMs: number,
): number {
  if (!Number.isFinite(reportedAtMs) || !Number.isFinite(nowMs)) return 0;
  return Math.max(0, Math.floor((nowMs - reportedAtMs) / 60_000));
}

export function occupancyAgeLabel(ageMinutes: number): string {
  if (ageMinutes <= 0) return "just now";
  if (ageMinutes === 1) return "1 min ago";
  return `${ageMinutes} min ago`;
}

export function occupancyReceiptLine(
  level: OccupancyLevel,
  ageMinutes: number,
): string {
  return `Thanks - ${OCCUPANCY_LEVEL_LABELS[level]}, ${occupancyAgeLabel(ageMinutes)}`;
}

export function occupancyNowFromReports(
  reports: readonly OccupancyReport[],
  nowMs: number,
  opts?: { degraded?: boolean },
): OccupancyNowAnswer {
  if (opts?.degraded) {
    return {
      now: null,
      ageMinutes: null,
      reportsLast90: 0,
      degraded: true,
      state: "degraded",
    };
  }
  const dated = reports
    .map((row) => {
      const reportedAtMs = Date.parse(row.reportedAt);
      return { row, reportedAtMs };
    })
    .filter(({ reportedAtMs }) => Number.isFinite(reportedAtMs));

  const fresh = dated
    .filter(
      ({ reportedAtMs }) =>
        nowMs - reportedAtMs <= OCCUPANCY_FRESH_WINDOW_MS &&
        nowMs - reportedAtMs >= 0,
    )
    .sort((a, b) => b.reportedAtMs - a.reportedAtMs);

  const newest = fresh[0];
  if (newest) {
    return {
      now: newest.row.level,
      ageMinutes: occupancyAgeMinutes(newest.reportedAtMs, nowMs),
      reportsLast90: fresh.length,
      degraded: false,
      state: "fresh",
    };
  }
  const hadOlder = dated.some(({ reportedAtMs }) => nowMs - reportedAtMs > OCCUPANCY_FRESH_WINDOW_MS);
  return {
    now: null,
    ageMinutes: null,
    reportsLast90: 0,
    degraded: false,
    state: hadOlder ? "stale" : "none",
  };
}

/**
 * Age a held answer forward by the time since it was read. A surface may hold
 * one for as long as a sheet stays open, and the 90-minute rule is derived on
 * READ, so the held answer keeps being re-derived: past the window it stops
 * claiming a level and reads as stale.
 */
export function occupancyAnswerAfter(
  answer: OccupancyNowAnswer,
  elapsedMs: number,
): OccupancyNowAnswer {
  if (!answer.now || answer.ageMinutes == null) return answer;
  const elapsed =
    Number.isFinite(elapsedMs) && elapsedMs > 0 ? elapsedMs : 0;
  const agedMs = answer.ageMinutes * 60_000 + elapsed;
  if (agedMs > OCCUPANCY_FRESH_WINDOW_MS) {
    return {
      now: null,
      ageMinutes: null,
      reportsLast90: 0,
      degraded: false,
      state: "stale",
    };
  }
  return { ...answer, ageMinutes: Math.floor(agedMs / 60_000) };
}

export function occupancyReadState(
  answer: OccupancyNowAnswer,
): OccupancyReadState {
  return answer.state;
}

export function occupancyReadingLine(answer: OccupancyNowAnswer): string {
  if (answer.degraded) return "Could not check how busy it is.";
  if (!answer.now || answer.ageMinutes == null) return "No fresh reading";
  return `${OCCUPANCY_LEVEL_LABELS[answer.now]} · ${occupancyAgeLabel(answer.ageMinutes)}`;
}

/**
 * Whether a given report may still be updated by a re-tap.
 * Same account, same pub, inside the 15-minute window.
 */
export function occupancyRetakeOpen(
  reportedAt: string,
  nowMs: number,
): boolean {
  const reportedAtMs = Date.parse(reportedAt);
  if (!Number.isFinite(reportedAtMs)) return false;
  const age = nowMs - reportedAtMs;
  return age >= 0 && age < OCCUPANCY_RETAKE_WINDOW_MS;
}
