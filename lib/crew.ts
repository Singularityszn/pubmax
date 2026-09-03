import { cleanText } from "@/lib/textClean";

export const CREW_NAME_MAX = 40;
export const CREW_MAX_MEMBERS = 20;

export const CREW_PRESENCE_STATUSES = [
  "in",
  "on_the_way",
  "here",
  "running_late",
  "start_without_me",
] as const;

export type CrewPresenceStatus = (typeof CREW_PRESENCE_STATUSES)[number];

export type CrewMemberDTO = {
  id: string;
  name: string;
  status: CrewPresenceStatus;
  joinedAt: string;
  updatedAt: string;
};

export function cleanCrewName(value: unknown): string {
  return cleanText(value, CREW_NAME_MAX);
}

/** Signed-in lock-in: prefer account metadata over an empty composer field. */
export function creatorNameFromAuthUser(user: {
  email?: string | null;
  user_metadata?: Record<string, unknown> | null;
}): string {
  const meta = user.user_metadata ?? {};
  const raw =
    (typeof meta.full_name === "string" && meta.full_name.trim())
    || (typeof meta.name === "string" && meta.name.trim())
    || (typeof user.email === "string" && user.email.split("@")[0]?.trim())
    || "";
  return cleanCrewName(raw);
}

export function isCrewPresenceStatus(value: unknown): value is CrewPresenceStatus {
  return typeof value === "string" && CREW_PRESENCE_STATUSES.includes(value as CrewPresenceStatus);
}

/**
 * The roster size that makes a Plan a crew night: at least two committed
 * humans. `docs/METRICS_FUNNEL.md` §0 owns the formula this serves.
 */
export const CREW_NIGHT_MIN_PARTICIPANTS = 2;

/**
 * True only for the join that took a roster UP TO the crew-night threshold.
 *
 * The per-night metric counts NIGHTS, so the match is exact rather than `>=`:
 * a join adds exactly one member, so the roster crosses the threshold once,
 * and the third and later joins belong to a night already counted. Reading
 * `>= 2` here is what made one four-person plan report three crew nights.
 */
export function joinCommitsCrewNight(participantsAfterJoin: number): boolean {
  return participantsAfterJoin === CREW_NIGHT_MIN_PARTICIPANTS;
}
