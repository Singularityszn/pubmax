// Ways to get between two stops of a night: walk, tube, bus and the rest of
// TfL, each with its time, its fare and its exact path, and the fastest and
// the cheapest marked. Pure and client-safe; the TfL read is in
// lib/tflLegOptions.server.ts and the route is app/api/leg-options.
//
// Honest by construction:
// - A fare is TfL's own `fare.totalCost` in pence, or null. A null fare reads
//   "Fare not listed" and can never be the cheapest: nothing is guessed.
// - Walking is free, so a walk option's fare is 0.
// - The path is the line TfL itself draws for each part. TfL plans no walk
//   over about two kilometres, so then the walk is a straight-line estimate
//   (`estimate`): its words say so, the map draws it as approximate, and it is
//   never the fastest while TfL offers a timed option.

export type LegMode = "walking" | "tube" | "bus" | "overground" | "elizabeth-line" | "dlr" | "national-rail" | "tram" | "other";

/** One part of an option: walk to the station, ride the Central line, and so on. */
export type LegPart = {
  mode: LegMode;
  /** The line or route name TfL gives ("Central", "98"), or null for a walk. */
  line: string | null;
  minutes: number;
  /** [lng, lat] points, in walking order. */
  path: [number, number][];
};

export type LegOption = {
  /** Stable within one answer: "walk", "transit-0", "transit-1", ... */
  id: string;
  kind: "walk" | "transit";
  minutes: number;
  /** TfL's fare in pence, 0 for a walk, or null when TfL lists none. */
  farePence: number | null;
  parts: LegPart[];
  /** A straight-line walk estimate, not a route TfL planned. */
  estimate: boolean;
  fastest: boolean;
  cheapest: boolean;
};

/** GET /api/leg-options: TfL's options for one leg, or "unavailable" with none. */
export type LegOptionsResponse = {
  status: "ok" | "unavailable";
  options: LegOption[];
};

const KNOWN_MODES = new Set<LegMode>(["walking", "tube", "bus", "overground", "elizabeth-line", "dlr", "national-rail", "tram"]);

export function legMode(raw: unknown): LegMode {
  return typeof raw === "string" && KNOWN_MODES.has(raw as LegMode) ? (raw as LegMode) : "other";
}

/**
 * TfL's `path.lineString` is a JSON-ish string of [lat, lng] pairs. The map
 * draws [lng, lat]. Anything that does not parse to at least two finite
 * points is no path at all.
 */
export function parseTflLineString(raw: unknown): [number, number][] {
  if (typeof raw !== "string" || raw.length < 5) return [];
  let pairs: unknown;
  try {
    pairs = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(pairs)) return [];
  const points: [number, number][] = [];
  for (const pair of pairs) {
    if (!Array.isArray(pair) || pair.length < 2) continue;
    const [lat, lng] = pair as unknown[];
    if (typeof lat !== "number" || typeof lng !== "number" || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    points.push([lng, lat]);
  }
  return points.length >= 2 ? points : [];
}

/**
 * Mark the fastest (fewest minutes) and the cheapest (lowest listed fare)
 * options, and order them fastest first. A tie keeps both marks on the first
 * one in TfL's order. An option with no listed fare is never the cheapest.
 */
export function rankLegOptions(options: readonly Omit<LegOption, "fastest" | "cheapest">[]): LegOption[] {
  // A straight-line estimate is shorter than any real walk, so it is only the
  // fastest when nothing TfL timed is on offer.
  const timed = options.some((option) => !option.estimate) ? options.filter((option) => !option.estimate) : options;
  const fastestMinutes = Math.min(...timed.map((option) => option.minutes));
  const priced = options.filter((option) => option.farePence !== null);
  const cheapestPence = priced.length ? Math.min(...priced.map((option) => option.farePence!)) : null;
  const fastestId = timed.find((option) => option.minutes === fastestMinutes)?.id ?? null;
  const cheapestId = cheapestPence === null ? null : priced.find((option) => option.farePence === cheapestPence)?.id ?? null;
  return options
    .map((option) => ({ ...option, fastest: option.id === fastestId, cheapest: option.id === cheapestId }))
    .sort((a, b) => a.minutes - b.minutes || (a.farePence ?? Infinity) - (b.farePence ?? Infinity));
}

/** "Free", "£2.80", or "Fare not listed". */
export function formatLegFare(farePence: number | null): string {
  if (farePence === null) return "Fare not listed";
  if (farePence === 0) return "Free";
  return `£${(farePence / 100).toFixed(2)}`;
}

const MODE_NAMES: Record<LegMode, string> = {
  walking: "Walk",
  tube: "Tube",
  bus: "Bus",
  overground: "Overground",
  "elizabeth-line": "Elizabeth line",
  dlr: "DLR",
  "national-rail": "Rail",
  tram: "Tram",
  other: "Transit",
};

/**
 * The option's name, from the parts that ride: "Walk", "Tube · Central",
 * "Bus 98 then Tube · Bakerloo". The walks to and from stations go unnamed.
 */
export function legOptionName(option: Pick<LegOption, "kind" | "parts">): string {
  if (option.kind === "walk") return "Walk";
  const rides = option.parts.filter((part) => part.mode !== "walking");
  if (rides.length === 0) return "Walk";
  return rides
    .map((part) => {
      const mode = MODE_NAMES[part.mode];
      if (!part.line) return mode;
      if (part.mode === "bus") return `Bus ${part.line}`;
      if (part.mode === "elizabeth-line" || part.line === mode) return mode;
      return `${mode} · ${part.line}`;
    })
    .join(" then ");
}
