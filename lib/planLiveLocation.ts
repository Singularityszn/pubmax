import { ACTIVE_PLAN_POST_MS, ACTIVE_PLAN_PRE_MS, LIVE_LOCATION_CUTOFF_HOUR } from "@/lib/nightWindows";

/** One crew member's latest shared fix. Never a history. */
export type PlanLiveLocationPerson = {
  memberId: string;
  name: string;
  latitude: number;
  longitude: number;
  accuracyM: number | null;
  updatedAt: string;
};

export type PlanLiveLocationView = {
  visibility: "member";
  /** False before the night opens and after it ends. Nobody is shown then. */
  live: boolean;
  endsAt: string | null;
  /** True while this reader's own position is shared. */
  sharing: boolean;
  /** Everyone else in the night who is sharing. */
  people: PlanLiveLocationPerson[];
};

export type PlanLiveLocationFix = { latitude: number; longitude: number; accuracyM: number | null };

/** A fix is sent at most this often while it moves. */
export const LIVE_LOCATION_SEND_MS = 20_000;
/** And at least this often while it stands still, so the crew sees it is fresh. */
export const LIVE_LOCATION_HEARTBEAT_MS = 60_000;
/** A dot older than this says when it was last seen. */
export const LIVE_LOCATION_STALE_MS = 3 * 60_000;
const MAX_ACCURACY_M = 10_000;

export function cleanLiveLocationFix(input: { latitude?: unknown; longitude?: unknown; accuracyM?: unknown }): PlanLiveLocationFix | null {
  const { latitude, longitude, accuracyM } = input;
  if (typeof latitude !== "number" || typeof longitude !== "number") return null;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  if (accuracyM === undefined || accuracyM === null) return { latitude, longitude, accuracyM: null };
  if (typeof accuracyM !== "number" || !Number.isFinite(accuracyM) || accuracyM < 0) return null;
  return { latitude, longitude, accuracyM: Math.min(MAX_ACCURACY_M, Math.round(accuracyM)) };
}

function londonParts(ms: number): { year: number; month: number; day: number; hour: number; offsetMs: number } {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(ms)).map((part) => [part.type, Number(part.value)]));
  const wall = Date.UTC(parts.year!, parts.month! - 1, parts.day!, parts.hour!, parts.minute!, parts.second!);
  return { year: parts.year!, month: parts.month!, day: parts.day!, hour: parts.hour!, offsetMs: wall - Math.floor(ms / 1000) * 1000 };
}

/**
 * The Plan's end, or the first 06:00 London time after the window opens, whichever is
 * first. The database owns the rule (0226 `plan_live_location_ends_at`); this
 * mirror serves the keyless store.
 */
export function planLiveLocationEndsAtMs(startTime: string): number | null {
  const start = Date.parse(startTime);
  if (!Number.isFinite(start)) return null;
  const local = londonParts(start - ACTIVE_PLAN_PRE_MS);
  const dayOffset = local.hour < LIVE_LOCATION_CUTOFF_HOUR ? 0 : 1;
  const sixWall = Date.UTC(local.year, local.month - 1, local.day + dayOffset, LIVE_LOCATION_CUTOFF_HOUR);
  const sixAm = sixWall - londonParts(sixWall).offsetMs;
  return Math.min(start + ACTIVE_PLAN_POST_MS, sixAm);
}

/** Sharing opens with the night's active window and closes at its end. */
export function isPlanLiveLocationOpen(startTime: string, status: string | undefined, now: number): boolean {
  const start = Date.parse(startTime);
  const end = planLiveLocationEndsAtMs(startTime);
  if (end === null || status === "ending" || status === "completed" || status === "abandoned") return false;
  return now >= start - ACTIVE_PLAN_PRE_MS && now < end;
}

function person(value: unknown): PlanLiveLocationPerson | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const fix = cleanLiveLocationFix(row);
  if (!fix || typeof row.memberId !== "string" || typeof row.name !== "string" || typeof row.updatedAt !== "string"
    || !Number.isFinite(Date.parse(row.updatedAt))) return null;
  return { memberId: row.memberId, name: row.name, ...fix, updatedAt: row.updatedAt };
}

/** Client guard for the private route's answer. Anything else reads as nothing. */
export function parsePlanLiveLocationView(value: unknown): PlanLiveLocationView | null {
  if (!value || typeof value !== "object") return null;
  const view = value as Record<string, unknown>;
  if (view.visibility !== "member" || typeof view.live !== "boolean" || typeof view.sharing !== "boolean"
    || !Array.isArray(view.people)) return null;
  if (view.endsAt !== null && (typeof view.endsAt !== "string" || !Number.isFinite(Date.parse(view.endsAt)))) return null;
  const people = view.people.map(person);
  if (people.some((row) => row === null)) return null;
  return { visibility: "member", live: view.live, endsAt: view.endsAt as string | null, sharing: view.sharing, people: people as PlanLiveLocationPerson[] };
}
