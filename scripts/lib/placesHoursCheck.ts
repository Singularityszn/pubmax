import type { WeeklyOpeningHours } from "../../lib/busyness";

const WEEK = 7 * 1440;
const RATE = 0.02;

/** Missing usage earns no assumed free credit. A retry is another paid call. */
export function planHoursCheck(wanted: number, alreadyUsed: number | null, capUsd: number) {
  if (!Number.isInteger(wanted) || wanted < 0 || !Number.isFinite(capUsd) || capUsd < 0
    || (alreadyUsed !== null && (!Number.isInteger(alreadyUsed) || alreadyUsed < 0))) {
    throw new Error("Invalid hours-check budget");
  }
  const free = alreadyUsed === null ? 0 : Math.max(0, 1000 - alreadyUsed);
  const calls = Math.min(wanted, free + Math.floor(capUsd * 100 / 2));
  const freeCalls = Math.min(free, calls);
  return { calls, freeCalls, projectedUsd: Math.round((calls - freeCalls) * RATE * 100) / 100 };
}

function mark(week: Uint8Array, start: number, end: number) {
  for (let minute = start; minute < end; minute += 1) week[minute % WEEK] = 1;
}

function clock(value: unknown): number | null {
  if (typeof value !== "string" || !/^\d{2}:\d{2}$/.test(value)) return null;
  const [hour = Number.NaN, minute = Number.NaN] = value.split(":").map(Number);
  return hour <= 24 && minute < 60 && (hour < 24 || minute === 0) ? hour * 60 + minute : null;
}

function point(value: unknown): number | null {
  if (!value || typeof value !== "object") return null;
  const { day, hour = 0, minute = 0 } = value as Record<string, unknown>;
  if (typeof day !== "number" || typeof hour !== "number" || typeof minute !== "number"
    || !Number.isInteger(day) || day < 0 || day > 6
    || !Number.isInteger(hour) || hour < 0 || hour > 23
    || !Number.isInteger(minute) || minute < 0 || minute > 59) return null;
  return day * 1440 + hour * 60 + minute;
}

/** Without stored hours every verdict is "unknown", so no Details call can change it. */
export function hasHours(ours: WeeklyOpeningHours | null): ours is WeeklyOpeningHours {
  return !!ours && Object.keys(ours).length > 0;
}

/** Compare complete weekly occupancy in memory, including split and overnight periods. */
export function compareHours(ours: WeeklyOpeningHours | null, periods: unknown): "match" | "mismatch" | "unknown" {
  if (!hasHours(ours) || !Array.isArray(periods) || !periods.length) return "unknown";
  const local = new Uint8Array(WEEK);
  const google = new Uint8Array(WEEK);
  for (let day = 0; day < 7; day += 1) {
    for (const window of ours[day] ?? []) {
      const start = clock(window.opens), end = clock(window.closes);
      if (start === null || end === null || start >= 1440 || start === end) return "unknown";
      mark(local, day * 1440 + start, day * 1440 + end + (end < start ? 1440 : 0));
    }
  }
  for (const period of periods) {
    if (!period || typeof period !== "object") return "unknown";
    const start = point(period.open);
    if (start === null) return "unknown";
    if (period.close === undefined) {
      if (periods.length !== 1 || start !== 0) return "unknown";
      google.fill(1);
      break;
    }
    const end = point(period.close);
    if (end === null || end === start) return "unknown";
    mark(google, start, end + (end < start ? WEEK : 0));
  }
  return local.every((value, minute) => value === google[minute]) ? "match" : "mismatch";
}

export type HoursVenue = { venueId: string; googlePlaceId: string; hours: WeeklyOpeningHours | null };
export type HoursVerdictRow = { venueId: string; googlePlaceId: string; verdict: "match" | "mismatch" | "unknown"; verifiedAt: string };

/** Match the enrichment runner: only a missing place or non-key invalid argument fails its row. */
async function placeLevelFailure(response: Response): Promise<boolean> {
  if (response.status === 404) return true;
  if (response.status !== 400) return false;
  const body = await response.json().catch(() => null);
  const reasons = Array.isArray(body?.error?.details)
    ? body.error.details.map((detail: { reason?: unknown } | null) => String(detail?.reason ?? "")) : [];
  return body?.error?.status === "INVALID_ARGUMENT"
    && !reasons.some((reason: string) => reason.startsWith("API_KEY"));
}

/** Responses never escape this loop. Checkpoint writes receive verdicts only. */
export async function checkHours(options: {
  venues: HoursVenue[];
  maxCalls: number;
  apiKey: string;
  fetchImpl?: typeof fetch;
  save: (rows: HoursVerdictRow[], calls: number) => void;
  pace?: () => Promise<void>;
  signal?: AbortSignal;
}) {
  const rows: HoursVerdictRow[] = [];
  let calls = 0;
  for (const venue of options.venues) {
    if (!hasHours(venue.hours)) {
      rows.push({ venueId: venue.venueId, googlePlaceId: venue.googlePlaceId, verdict: "unknown", verifiedAt: new Date().toISOString() });
      options.save(rows, calls);
      continue;
    }
    if (calls >= options.maxCalls) continue;
    options.signal?.throwIfAborted();
    await options.pace?.();
    options.signal?.throwIfAborted();
    calls += 1;
    // Reserve the charge durably before sending, including a failed request.
    options.save(rows, calls);
    const response = await (options.fetchImpl ?? fetch)(
      `https://places.googleapis.com/v1/places/${encodeURIComponent(venue.googlePlaceId)}`,
      { headers: { "X-Goog-Api-Key": options.apiKey, "X-Goog-FieldMask": "regularOpeningHours.periods" }, signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(20_000)]) : AbortSignal.timeout(20_000) },
    );
    if (!response.ok) {
      if (await placeLevelFailure(response)) {
        rows.push({ venueId: venue.venueId, googlePlaceId: venue.googlePlaceId,
          verdict: "unknown", verifiedAt: new Date().toISOString() });
        options.save(rows, calls);
        continue;
      }
      throw new Error(`Places Details HTTP ${response.status}; charged request reserved, stop before retry`);
    }
    let body;
    try { body = await response.json(); } catch { throw new Error("Places Details response unreadable; stop before retry"); }
    rows.push({ venueId: venue.venueId, googlePlaceId: venue.googlePlaceId,
      verdict: compareHours(venue.hours, body.regularOpeningHours?.periods), verifiedAt: new Date().toISOString() });
    options.save(rows, calls);
  }
  return { rows, calls };
}
