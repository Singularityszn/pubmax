// Host attendance on an open crew's night (migration 0247). A pure leaf: the closed
// vocabulary and the one parser for the read, shared by the store and the crew page.
// A host mark is a practical signal from the host, not a check of who was there.

const CREW_ATTENDANCE_STATES = ["attended", "absent"] as const;
export type CrewAttendanceState = (typeof CREW_ATTENDANCE_STATES)[number];

export function isCrewAttendanceState(value: unknown): value is CrewAttendanceState {
  return CREW_ATTENDANCE_STATES.includes(value as CrewAttendanceState);
}

type CrewAttendanceItem = {
  memberId: string;
  /** Null with revision 0 when nobody has marked this person. */
  state: CrewAttendanceState | null;
  revision: number;
  recordedAt: string | null;
  recordedBy: "host" | "moderator" | null;
};

export type CrewAttendanceDTO = {
  /** True for an owner or co-host. Their items list every member they may mark. */
  canAttest: boolean;
  open: boolean;
  opensAt: string;
  closesAt: string;
  /** For anyone else, only their own mark, when there is one. */
  items: CrewAttendanceItem[];
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isInstant = (value: unknown): value is string => typeof value === "string" && Number.isFinite(Date.parse(value));

function parseItem(value: unknown): CrewAttendanceItem | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const { memberId, state, revision, recordedAt, recordedBy } = value as Record<string, unknown>;
  if (typeof memberId !== "string" || !UUID_RE.test(memberId)) return null;
  if (!Number.isInteger(revision) || (revision as number) < 0) return null;
  if (revision === 0) {
    return state === null && recordedAt === null && recordedBy === null
      ? { memberId, state: null, revision: 0, recordedAt: null, recordedBy: null }
      : null;
  }
  if (!isCrewAttendanceState(state) || !isInstant(recordedAt) || (recordedBy !== "host" && recordedBy !== "moderator")) return null;
  return { memberId, state, revision: revision as number, recordedAt, recordedBy };
}

/** The whole read, or null when any part is malformed. A null is unavailable, never empty. */
export function parseCrewAttendance(value: unknown): CrewAttendanceDTO | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const { canAttest, open, opensAt, closesAt, items } = value as Record<string, unknown>;
  if (typeof canAttest !== "boolean" || typeof open !== "boolean" || !isInstant(opensAt) || !isInstant(closesAt)
    || !Array.isArray(items)) return null;
  const parsed: CrewAttendanceItem[] = [];
  const seen = new Set<string>();
  for (const candidate of items) {
    const item = parseItem(candidate);
    if (!item || seen.has(item.memberId)) return null;
    seen.add(item.memberId);
    parsed.push(item);
  }
  return { canAttest, open, opensAt, closesAt, items: parsed };
}
