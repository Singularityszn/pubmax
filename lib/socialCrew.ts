import type {
  CrawlEnding,
  PlanActionDTO,
  PlanDTO,
  PlannedNightStatus,
  PlanStopDTO,
} from "@/lib/plan";
import type { NightContext } from "@/lib/nightPlanning";
import type { OutOpenPlanMeetingPoint } from "@/lib/out";
import type { OpenCrawlDetails, StillTruePublicFacts } from "@/lib/openCrawl";
import type { OpenCrawlShareArea, OpenCrawlShareSpendBand } from "@/lib/openCrawlShareCard";
import { PLAN_STOP_MAX } from "@/lib/plan";

const SOCIAL_CREW_ROLES = ["owner", "cohost", "member"] as const;
export type SocialCrewRole = (typeof SOCIAL_CREW_ROLES)[number];

/**
 * The header that carries the Plan host capability when a crew is started.
 * `Authorization` belongs to the signed-in account (the Supabase access token,
 * which is a few hundred characters long), so the Plan capability cannot share it.
 */
export const SOCIAL_CREW_HOST_CAPABILITY_HEADER = "x-plan-host-capability";

export const SOCIAL_CREW_VISIBILITIES = ["private", "friends", "open"] as const;
export type SocialCrewVisibility = (typeof SOCIAL_CREW_VISIBILITIES)[number];

export type SocialCrewPhase = "planning" | "live" | "ended";
const SOCIAL_CREW_MEMBERSHIP_STATES = ["active", "left", "removed"] as const;
export type SocialCrewMembershipState = (typeof SOCIAL_CREW_MEMBERSHIP_STATES)[number];

export type SocialCrewJoinRequestDTO = {
  requestId: string;
  requesterHandle: string;
};

export type SocialCrewJoinRequestQueueDTO = {
  items: SocialCrewJoinRequestDTO[];
  hasMore: boolean;
};

const SOCIAL_CREW_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function socialCrewRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function socialCrewExactRecordKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const expected = new Set(keys);
  return Object.keys(value).length === expected.size &&
    Object.keys(value).every((key) => expected.has(key));
}

export function parseSocialCrewJoinRequestQueue(
  value: unknown,
): SocialCrewJoinRequestQueueDTO | null {
  if (
    !socialCrewRecord(value) ||
    !socialCrewExactRecordKeys(value, ["items", "hasMore"]) ||
    !Array.isArray(value.items) ||
    typeof value.hasMore !== "boolean"
  ) {
    return null;
  }
  const items: SocialCrewJoinRequestDTO[] = [];
  const requestIds = new Set<string>();
  if (value.items.length > 50) return null;
  for (const candidate of value.items) {
    if (
      !socialCrewRecord(candidate) ||
      !socialCrewExactRecordKeys(candidate, [
        "requestId",
        "requesterHandle",
      ]) ||
      typeof candidate.requestId !== "string" ||
      !SOCIAL_CREW_UUID_RE.test(candidate.requestId) ||
      typeof candidate.requesterHandle !== "string" ||
      candidate.requesterHandle.trim().length === 0 ||
      requestIds.has(candidate.requestId)
    ) {
      return null;
    }
    requestIds.add(candidate.requestId);
    items.push({
      requestId: candidate.requestId,
      requesterHandle: candidate.requesterHandle,
    });
  }
  return { items, hasMore: value.hasMore };
}

export type SocialCrewMemberDTO = {
  memberId: string;
  handle: string;
  role: SocialCrewRole;
  joinedAt: string;
};

export type SocialCrewPlanDTO = {
  plan: PlanDTO;
  stops: PlanStopDTO[];
  context: NightContext | null;
  actions: PlanActionDTO[];
  ending: CrawlEnding | null;
};

export type SocialCrewPreviewDTO = {
  kind: "preview";
  title: string;
  phase: SocialCrewPhase;
  nightArea: string | null;
  startsAt: string;
  joinRequestState: "none" | "pending" | "declined";
  hostHandle?: string;
  stopVenueId?: string | null;
  stopVenueName?: string | null;
  memberCount?: number;
};

export type SocialCrewPageDTO = {
  kind: "member";
  crewId: string;
  title: string;
  visibility: SocialCrewVisibility;
  phase: SocialCrewPhase;
  nightArea: string | null;
  startsAt: string;
  authorityRevision: number;
  viewer: { memberId: string; role: SocialCrewRole };
  owner: { memberId: string; handle: string };
  members: SocialCrewMemberDTO[];
  plan: SocialCrewPlanDTO;
  /**
   * An open crawl's capacity, meeting pub and the host's line (0208). Absent
   * on a crew that is not open, null on an open crew that carries none.
   */
  openCrawl?: OpenCrawlDetails | null;
  arrival?: { open: boolean; here: boolean; refreshAt: number | null };
};

export type SocialCrewReadDTO = SocialCrewPreviewDTO | SocialCrewPageDTO;

/**
 * Legacy 0115 public source used by the share-card fallback to check visibility.
 * SocialCrewShareCardSource below owns the fallback's meeting-point rules.
 */
export type SocialCrewPublicPreviewSource = {
  crewId: string;
  title: string;
  hostHandle: string;
  startsAt: string;
  stopVenueId: string;
  stopVenueName: string;
};

/**
 * Account-free Open Crew contract. Member identities, join requests and the
 * full plan remain behind the authenticated read.
 */
export type SocialCrewPublicPreviewDTO = {
  kind: "public";
  crewId: string;
  title: string;
  hostHandle: string;
  startsAt: string;
  meetingPoint: OutOpenPlanMeetingPoint;
  /** The area the meeting pub sits in or near, or null when it is in none we curate. */
  area: OpenCrawlShareArea | null;
  /** Places left, or null when capacity or active seat count is unavailable. Never a member count. */
  placesLeft: number | null;
  /** Min-max listed pint price over the stops, or null. Never the stops themselves. */
  spendBand: OpenCrawlShareSpendBand | null;
  /**
   * A one-pub night. Absent or null on a crawl with any other shape.
   * Unavailable counts stay null. lib/openCrawl.ts owns their definitions.
   */
  stillTrue?: StillTruePublicFacts | null;
};

export type SocialCrewListItemDTO = Pick<
  SocialCrewPageDTO,
  "kind" | "crewId" | "title" | "phase" | "nightArea" | "startsAt" | "viewer"
>;

export type SocialCrewListPageDTO = {
  items: SocialCrewListItemDTO[];
  nextCursor: string | null;
};

const SOCIAL_CREW_MUTATION_CODES = [
  "created",
  "invited",
  "accepted",
  "declined",
  "revoked",
  "requested",
  "cancelled",
  "updated",
  "transferred",
  "removed",
  "left",
  "replayed",
] as const;
export type SocialCrewMutationCode = (typeof SOCIAL_CREW_MUTATION_CODES)[number];

export type SocialCrewMutationResult = {
  code: SocialCrewMutationCode;
  replayed: boolean;
  crewId?: string;
  memberId?: string;
  invitationId?: string;
  requestId?: string;
  authorityRevision?: number;
};

export function isSocialCrewRole(value: unknown): value is SocialCrewRole {
  return SOCIAL_CREW_ROLES.includes(value as SocialCrewRole);
}

export function isSocialCrewMembershipState(
  value: unknown,
): value is SocialCrewMembershipState {
  return SOCIAL_CREW_MEMBERSHIP_STATES.includes(value as SocialCrewMembershipState);
}

export function isSocialCrewVisibility(
  value: unknown,
): value is SocialCrewVisibility {
  return SOCIAL_CREW_VISIBILITIES.includes(value as SocialCrewVisibility);
}

export function isSocialCrewMutationCode(
  value: unknown,
): value is SocialCrewMutationCode {
  return SOCIAL_CREW_MUTATION_CODES.includes(value as SocialCrewMutationCode);
}

const SOCIAL_CREW_PUBLIC_SOURCE_KEYS = [
  "crewId",
  "title",
  "hostHandle",
  "startsAt",
  "stopVenueId",
  "stopVenueName",
] as const;

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length &&
    keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function publicIsoTimestamp(value: unknown): string | null {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/.test(value)
  ) {
    return null;
  }
  const epoch = Date.parse(value);
  return Number.isFinite(epoch) ? new Date(epoch).toISOString() : null;
}

/** Parse service output before any public preview route can use it. */
export function parseSocialCrewPublicPreviewSource(
  value: unknown,
): SocialCrewPublicPreviewSource | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (!exactKeys(row, SOCIAL_CREW_PUBLIC_SOURCE_KEYS)) return null;
  if (
    typeof row.crewId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(row.crewId) ||
    typeof row.title !== "string" ||
    !row.title.trim() ||
    typeof row.hostHandle !== "string" ||
    !row.hostHandle.trim() ||
    typeof row.stopVenueId !== "string" ||
    !row.stopVenueId.trim() ||
    typeof row.stopVenueName !== "string" ||
    !row.stopVenueName.trim()
  ) {
    return null;
  }
  const startsAt = publicIsoTimestamp(row.startsAt);
  if (!startsAt) return null;
  return {
    crewId: row.crewId,
    title: row.title,
    hostHandle: row.hostHandle,
    startsAt,
    stopVenueId: row.stopVenueId,
    stopVenueName: row.stopVenueName,
  };
}

/**
 * Service-only source for an open crawl's link preview (0225). The stop ids
 * are read on the server for a price band and never reach a browser. A null
 * capacity is an open crew with no open crawl facts. The fallback uses 0115
 * for public visibility and 0208 for the host's meeting pub and capacity.
 * It uses Stop 1 only when 0208 returns no open crawl facts. A failed 0208
 * read refuses the card. The fallback has no seat count or stop list, so it
 * supports neither places left nor a price band.
 */
export type SocialCrewShareCardSource = {
  crewId: string;
  title: string;
  hostHandle: string;
  startsAt: string;
  capacity: number | null;
  memberCount: number | null;
  meetingVenueId: string;
  meetingVenueName: string;
  stopVenueIds: string[] | null;
};

const SOCIAL_CREW_SHARE_CARD_KEYS = [
  "crewId",
  "title",
  "hostHandle",
  "startsAt",
  "capacity",
  "memberCount",
  "meetingVenueId",
  "meetingVenueName",
  "stopVenueIds",
] as const;

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** Parse 0225 service output before the link preview can use it. */
export function parseSocialCrewShareCardSource(
  value: unknown,
): SocialCrewShareCardSource | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (!exactKeys(row, SOCIAL_CREW_SHARE_CARD_KEYS)) return null;
  if (
    typeof row.crewId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(row.crewId) ||
    !nonEmptyString(row.title) ||
    !nonEmptyString(row.hostHandle) ||
    !nonEmptyString(row.meetingVenueId) ||
    !nonEmptyString(row.meetingVenueName)
  ) {
    return null;
  }
  const startsAt = publicIsoTimestamp(row.startsAt);
  if (!startsAt) return null;
  const capacity = row.capacity;
  if (capacity !== null && (!Number.isInteger(capacity) || Number(capacity) < 1)) return null;
  const memberCount = row.memberCount;
  if (!Number.isInteger(memberCount) || Number(memberCount) < 0) return null;
  const stops = row.stopVenueIds;
  if (
    !Array.isArray(stops) ||
    stops.length === 0 ||
    stops.length > PLAN_STOP_MAX ||
    !stops.every(nonEmptyString)
  ) {
    return null;
  }
  return {
    crewId: row.crewId,
    title: row.title,
    hostHandle: row.hostHandle,
    startsAt,
    capacity: capacity === null ? null : Number(capacity),
    memberCount: Number(memberCount),
    meetingVenueId: row.meetingVenueId,
    meetingVenueName: row.meetingVenueName,
    stopVenueIds: [...stops],
  };
}

export function socialCrewPhase(status: PlannedNightStatus): SocialCrewPhase {
  switch (status) {
    case "draft":
    case "ready":
      return "planning";
    case "active":
    case "ending":
      return "live";
    case "completed":
    case "abandoned":
      return "ended";
    default: {
      const unreachable: never = status;
      return unreachable;
    }
  }
}
