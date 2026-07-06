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

// The full answer for a point: which station, how far, and each serving line's
// last train tonight. `generatedAt` is an ISO string for provenance/debugging.
export type LastTrainResult = {
  station: { id: string; name: string; distanceM: number };
  trains: LastTrain[];
  generatedAt: string;
};
