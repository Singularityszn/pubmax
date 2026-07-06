// TfL "last drink / last train home" helpers — pure, unit-tested, no network.
//
// This module holds only the deterministic bits of the last-train feature: the
// official TfL line colours, the London day-type mapping, and the after-midnight
// clock formatting. The API route (app/api/last-train/route.ts) does the fetching
// and wires these helpers together; keeping fetch out of here makes every branch
// trivially testable (see __tests__/tfl.test.ts) and side-effect free.
//
// Why the after-midnight maths matters: TfL timetables express the last journey
// of a service day with hours that roll past 24 (e.g. {hour:24,minute:28} = 00:28
// the next calendar day; {hour:26,minute:57} = 02:57 — Night Tube). Real clock
// time is therefore `hour % 24`, and anything with hour >= 24 belongs to tomorrow.

// Official TfL Colour Standard (Issue 10) line colours, keyed by TfL lineId.
// Used to draw the small line dot in LastTrainCard so it reads like the real map.
export const LINE_COLOURS: Record<string, string> = {
  bakerloo: "#B26300",
  central: "#DC241F",
  circle: "#FFC80A",
  district: "#007D32",
  "hammersmith-city": "#F589A6",
  jubilee: "#838D93",
  metropolitan: "#9B0058",
  northern: "#000000",
  piccadilly: "#0019A8",
  victoria: "#039BE5",
  "waterloo-city": "#76D0BD",
  elizabeth: "#60399E",
  dlr: "#00AFAD",
  "london-overground": "#FA7B05",
  liberty: "#5D6061",
  lioness: "#FAA61A",
  mildmay: "#0077AD",
  suffragette: "#5BBD72",
  weaver: "#823A62",
  windrush: "#ED1B00",
  tram: "#5FB526",
};

// Neutral brass-ish fallback for any line we don't have a colour for (new lines,
// rail modes, typos) so the dot never renders blank.
const FALLBACK_COLOUR = "#6b726a";

// The hex colour for a TfL lineId, or the neutral fallback for unknown ids.
export function lineColour(lineId: string): string {
  return LINE_COLOURS[lineId] ?? FALLBACK_COLOUR;
}

// The four TfL timetable "day types". Weekday timetables collapse Mon-Thu into a
// single schedule; Fri, Sat and Sun each get their own (late-night services differ).
export type DayType = "mon-thu" | "fri" | "sat" | "sun";

// The day-type for a given Date, from its weekday. The caller passes a Date that
// already represents "now in London" (the route uses the Europe/London locale),
// so we can read getDay() directly: 0 = Sunday … 6 = Saturday.
export function dayTypeForDate(d: Date): DayType {
  switch (d.getDay()) {
    case 0:
      return "sun";
    case 5:
      return "fri";
    case 6:
      return "sat";
    default:
      // Monday (1) through Thursday (4).
      return "mon-thu";
  }
}

// Does a TfL schedule name (e.g. "Monday - Thursday", "Saturday (also Good Friday)")
// match the given day-type? Case-insensitive substring logic on the weekday words —
// TfL is inconsistent about phrasing, so we look for the day name(s) rather than an
// exact match. For Mon-Thu we accept any of the four weekday names appearing.
export function matchesDayType(scheduleName: string, dt: DayType): boolean {
  const name = scheduleName.toLowerCase();
  switch (dt) {
    case "fri":
      return name.includes("friday");
    case "sat":
      return name.includes("saturday");
    case "sun":
      return name.includes("sunday");
    case "mon-thu":
      return (
        name.includes("monday") ||
        name.includes("tuesday") ||
        name.includes("wednesday") ||
        name.includes("thursday")
      );
  }
}

// A TfL journey time. Note TfL returns these as strings in the wire format
// ("24", "34"); the route coerces them to numbers before calling in, and the
// type here is the clean numeric shape.
export type JourneyTime = { hour: number; minute: number };

// Format a (possibly after-midnight) last-journey time into a real wall clock.
//   {23,42} → { clock: "23:42", pastMidnight: false }
//   {24,28} → { clock: "00:28", pastMidnight: true  }   (00:28 tomorrow)
//   {26,57} → { clock: "02:57", pastMidnight: true  }   (02:57 tomorrow, Night Tube)
export function formatLastJourney({ hour, minute }: JourneyTime): {
  clock: string;
  pastMidnight: boolean;
} {
  const realHour = ((hour % 24) + 24) % 24;
  const hh = String(realHour).padStart(2, "0");
  const mm = String(minute).padStart(2, "0");
  return { clock: `${hh}:${mm}`, pastMidnight: hour >= 24 };
}

// One line's last train from a station tonight, ready for the card to render.
export type LastTrain = {
  lineId: string;
  lineName: string;
  colour: string;
  clock: string;
  pastMidnight: boolean;
};

// One line's upcoming departures (live "next departures", not just the last
// train). `dueIn` values are minutes-from-now the way TfL's Arrivals API reports
// them; the route sorts and slices to the soonest few per line before this
// reaches the card, so `times` is already "next 2-3" by the time it's rendered.
export type NextDepartures = {
  lineId: string;
  lineName: string;
  colour: string;
  times: string[]; // "HH:MM" wall-clock, soonest first
  live: boolean; // true = from live Arrivals, false = timetable fallback
};

// The full answer for a point: which station, how far, and each serving line's
// last train tonight. `generatedAt` is an ISO string for provenance/debugging.
export type LastTrainResult = {
  station: { id: string; name: string; distanceM: number };
  trains: LastTrain[];
  generatedAt: string;
  // Additive fields (user stories 20-24) — optional so any older consumer that
  // only reads {station, trains, generatedAt} keeps working untouched.
  departures?: NextDepartures[];
  decision?: LastPintDecision;
  nearestPubs?: NearestPub[];
};

// --- Last Pint decision (user stories 19, 21, 23, 24) ---------------------
//
// The pub-native "what do I do right now" answer. Computed server-side, pure
// function of inputs below so it's trivially unit-testable without a clock or
// network mock beyond passing `now` explicitly.

export type LastPintDecisionKind =
  | "order_one_more"
  | "half_pint_only"
  | "settle_up_now"
  | "train_risk"
  | "live_data_unavailable";

export type LastPintDecision = {
  decision: LastPintDecisionKind;
  leaveByIso: string | null;
  stationName: string;
  lineNames: string[];
  disruptionSummary: string | null;
  walkMinutesEstimate: number;
  bufferMinutes: number;
  destinationLabel: string | null;
  live: boolean;
};

// Constant safety margin baked into the leave-by time: TfL's published last
// train can be a "doors closing" time, platforms aren't instant, and a drinker
// needs a moment to settle up and get moving. Documented here (not a magic
// number in the route) so the threshold story is legible in one place.
export const BUFFER_MINUTES = 5;

// Walking pace used to turn a straight-line venue→station distance into a time
// estimate. ~4.8km/h is a brisk-but-realistic evening walking speed; we label
// the result as straight-line (not routed), since MapLibre/OSRM routing is out
// of scope here.
const WALKING_KMH = 4.8;

export function walkMinutesForKm(distanceKm: number): number {
  if (!Number.isFinite(distanceKm) || distanceKm <= 0) return 0;
  return Math.round((distanceKm / WALKING_KMH) * 60);
}

export type LastPintDecisionInput = {
  // Minutes from `now` until the last train departs this station (can be
  // negative if it's already gone). Null when we have no last-train time at
  // all for the relevant line(s) (e.g. no timetable resolved).
  minutesUntilLastTrain: number | null;
  walkMinutesEstimate: number;
  bufferMinutes?: number;
  stationName: string;
  lineNames: string[];
  // True if TfL Line Status reports a disruption affecting a line the drinker
  // needs (any severity below "Good Service" for that line).
  disruptionOnNeededLine: boolean;
  disruptionSummary?: string | null;
  destinationLabel?: string | null;
  // False when TfL itself couldn't be reached at all (StopPoint/timetable both
  // failed) — distinct from "reached TfL, no disruption, but no train times".
  live?: boolean;
  now?: Date;
};

// Pure decision function — user stories 19, 21, 24. Given how long until the
// last train (after subtracting the walk and safety buffer), returns the
// pub-native state plus everything the card needs to render it.
//
// Thresholds (minutes of margin = minutesUntilLastTrain - walk - buffer):
//   TfL unreachable                       -> live_data_unavailable
//   margin < 5  OR disruption on the line -> train_risk
//   5  <= margin < 20                     -> settle_up_now
//   20 <= margin < 45                     -> half_pint_only
//   margin >= 45                          -> order_one_more
export function computeLastPintDecision(input: LastPintDecisionInput): LastPintDecision {
  const {
    minutesUntilLastTrain,
    walkMinutesEstimate,
    bufferMinutes = BUFFER_MINUTES,
    stationName,
    lineNames,
    disruptionOnNeededLine,
    disruptionSummary = null,
    destinationLabel = null,
    live = true,
    now = new Date(),
  } = input;

  const base: Omit<LastPintDecision, "decision" | "leaveByIso"> = {
    stationName,
    lineNames,
    disruptionSummary,
    walkMinutesEstimate,
    bufferMinutes,
    destinationLabel,
    live,
  };

  if (!live || minutesUntilLastTrain === null) {
    return { ...base, decision: "live_data_unavailable", leaveByIso: null };
  }

  const leaveBy = new Date(now.getTime() + (minutesUntilLastTrain - walkMinutesEstimate) * 60_000);
  const leaveByIso = leaveBy.toISOString();
  const margin = minutesUntilLastTrain - walkMinutesEstimate - bufferMinutes;

  if (margin < 5 || disruptionOnNeededLine) {
    return { ...base, decision: "train_risk", leaveByIso };
  }
  if (margin < 20) {
    return { ...base, decision: "settle_up_now", leaveByIso };
  }
  if (margin < 45) {
    return { ...base, decision: "half_pint_only", leaveByIso };
  }
  return { ...base, decision: "order_one_more", leaveByIso };
}

// --- Nearest pubs to the station (user story 22) ---------------------------

export type NearestPub = {
  id: string;
  name: string;
  price: number | null;
};
