import type { PlanUsualDrink } from "@/lib/planUsualDrink";
import { cleanText } from "@/lib/textClean";

export const CREW_NAME_MAX = 40;
export const CREW_MAX_MEMBERS = 20;

const CREW_PRESENCE_STATUSES = [
  "in",
  "on_the_way",
  "here",
  "running_late",
  "start_without_me",
] as const;

export type CrewPresenceStatus = (typeof CREW_PRESENCE_STATUSES)[number];

export type CrewPresenceChip = { label: string; tone: "here" | "ahead" | "late" };

/**
 * What each status means. `arrived` counts a guest who turned up. `arriving`
 * joins it on the Night Mode sheet. `chip` is the "who is where" chip; a plain
 * "in" has none, so the row stays a glance.
 */
const CREW_PRESENCE: Record<CrewPresenceStatus, { arrived: boolean; arriving: boolean; chip: CrewPresenceChip | null }> = {
  in: { arrived: false, arriving: false, chip: null },
  on_the_way: { arrived: false, arriving: true, chip: { label: "on the way", tone: "ahead" } },
  here: { arrived: true, arriving: false, chip: { label: "here", tone: "here" } },
  running_late: { arrived: false, arriving: false, chip: { label: "lagging", tone: "late" } },
  start_without_me: { arrived: false, arriving: false, chip: { label: "catching up", tone: "late" } },
};

/** A status this build does not know, from an older or newer server, reads as a plain "in". */
export function crewPresence(status: CrewPresenceStatus): (typeof CREW_PRESENCE)[CrewPresenceStatus] {
  return Object.hasOwn(CREW_PRESENCE, status) ? CREW_PRESENCE[status] : CREW_PRESENCE.in;
}

export type CrewMemberDTO = {
  id: string;
  name: string;
  status: CrewPresenceStatus;
  joinedAt: string;
  updatedAt: string;
  /**
   * The member's usual drink for the round forecast (review item B6), or
   * absent when they have not picked one. Absent, not a default.
   */
  usualDrink?: PlanUsualDrink | null;
};

export function cleanCrewName(value: unknown): string {
  return cleanText(value, CREW_NAME_MAX);
}

/**
 * Signed-in lock-in: the name a host is offered for an empty composer field.
 *
 * THE PUBLIC HANDLE COMES FIRST, AND THE EMAIL NEVER COMES AT ALL (battle test
 * L05). This name is not a private convenience: it becomes the host name on the
 * plan, on the share card and in the unfurler, so it went out to everyone the
 * link reached as "pentest.alice is planning a night out". The handle is the
 * account's own public name here; a display name the person volunteered to the
 * identity provider is the fallback; an email address is neither.
 *
 * The handle argument is TRI-STATE by way of null, so a caller must not ask
 * until the live session has answered - a cached handle is exactly where the
 * previous account's name lives (lib/deviceAccountIdentity.ts).
 */
export function creatorNameFromAccount(input: {
  handle: string | null;
  user: { user_metadata?: Record<string, unknown> | null } | null;
}): string {
  const meta = input.user?.user_metadata ?? {};
  const raw =
    (typeof input.handle === "string" && input.handle.trim())
    || (typeof meta.full_name === "string" && meta.full_name.trim())
    || (typeof meta.name === "string" && meta.name.trim())
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

/**
 * The arrival bands a night's guests can reach, smallest first. A band, not a
 * count, because the launch metric asks "did four or more guests turn up?"
 * and a band crossing is a fact that happens once per night, while a raw count
 * would need a per-night key to take its maximum, and a per-night key is the
 * identity join ADR 0009 rules out.
 */
export const CREW_ARRIVED_BANDS = ["1", "2-3", "4+"] as const;
export type CrewArrivedBand = (typeof CREW_ARRIVED_BANDS)[number];

const CREW_ARRIVED_BAND_FLOORS: Record<CrewArrivedBand, number> = { "1": 1, "2-3": 2, "4+": 4 };

/**
 * Guests (everyone but the host) whose status is "Here". The host is the first
 * seat by join order, the same rule `planMemberIdentity` uses to name the host,
 * so a host who taps "Here" never counts as a guest who turned up.
 */
export function guestsArrived(crew: readonly Pick<CrewMemberDTO, "status">[]): number {
  return crew.slice(1).filter((member) => crewPresence(member.status).arrived).length;
}

export function crewArrivedBandsReached(crew: readonly Pick<CrewMemberDTO, "status">[]): CrewArrivedBand[] {
  const arrived = guestsArrived(crew);
  return CREW_ARRIVED_BANDS.filter((band) => arrived >= CREW_ARRIVED_BAND_FLOORS[band]);
}

/**
 * The arrival receipts a status write answered with, read defensively: only a
 * known band with a bounded token survives. The token is checked for real at
 * ingest; this only keeps a malformed body from reaching the beacon.
 */
export function parseCrewArrivedReceipts(value: unknown): { deliveryToken: string; guestsArrived: CrewArrivedBand }[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const { deliveryToken, guestsArrived } = item as Record<string, unknown>;
    if (typeof deliveryToken !== "string" || !deliveryToken || deliveryToken.length > 2_000) return [];
    if (!CREW_ARRIVED_BANDS.includes(guestsArrived as CrewArrivedBand)) return [];
    return [{ deliveryToken, guestsArrived: guestsArrived as CrewArrivedBand }];
  }).slice(0, CREW_ARRIVED_BANDS.length);
}
